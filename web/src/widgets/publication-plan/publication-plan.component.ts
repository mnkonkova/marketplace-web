import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzDrawerService } from 'ng-zorro-antd/drawer';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ProjectPerson, Publication } from '@entities/publication/model/publication.types';
import {
  SchedulePublicationsData,
  SchedulePublicationsDialogComponent,
} from '@features/schedule-publications/schedule-publications.dialog';
import { parseApiError } from '@shared/api/api-error';
import { PrMarketAvaComponent } from '@shared/ui/prmarket-ava/prmarket-ava.component';
import { SheetComponent } from '@shared/ui/sheet/sheet.component';
import { isTouchDevice, prefersSheet } from '@shared/lib/touch';

/** Клетка плана: один креатор в один день. */
interface Cell {
  date: string;
  day: number;
  /**
   * Состояние клетки — САМОЕ ТРЕВОЖНОЕ из роликов этого дня.
   *
   * '' пусто · p в плане · d вышел · l просрочен · r на проверке.
   * В дне роликов бывает несколько, и показывать надо то, что требует
   * внимания: день с просроченным и вышедшим роликом — это день, в
   * который надо смотреть, а галочка сказала бы обратное.
   */
  state: '' | 'p' | 'd' | 'l' | 'r';
  today: boolean;
  weekend: boolean;
  /** Последний день периода: дальше выкладки идут в следующий счёт. */
  periodEnd: boolean;
  /** Последняя выкладка периода — ею период и кончается по работе. */
  lastOfPeriod: boolean;
  /**
   * Все ролики этого дня, по номеру в дне.
   *
   * Список, а не один ролик: пока здесь лежала одна выкладка, второй
   * ролик того же дня не был виден в плане вообще — ни клеткой, ни
   * цифрой, — хотя на сервере он есть и в отчёт попадает.
   */
  pubs: Publication[];
  hint: string;
}

interface Row {
  person: ProjectPerson;
  cells: Cell[];
  /** Ближайшая несданная — её и пингуем колокольчиком. */
  nextOpen?: Publication;
  planned: number;
  done: number;
  late: number;
}

const WEEKEND = new Set([0, 6]);

/**
 * Единственный ряд плана у проекта без креаторов.
 *
 * Не человек и не заглушка вместо человека: ролик такого проекта
 * принадлежит проекту, и подпись говорит именно это. Пустой user_id —
 * то же самое «никто», которое лежит в базе.
 */
const PROJECT_ROW: ProjectPerson = {
  user_id: '',
  display_name: 'Ролики проекта',
  added_at: '',
};

/**
 * План выкладок: креаторы по строкам, дни по столбцам.
 *
 * Сетка, а не список, потому что менеджер решает здесь две задачи сразу:
 * «что у нас на этой неделе» (читается по столбцам) и «что у этого
 * человека» (по строке). Список умеет только первое, и вопрос «а Лев
 * вообще снимает в этом месяце» по нему не отвечается вовсе.
 *
 * Клетка — это действие, а не картинка. Пустая: поставить сюда выкладку.
 * Плановая: перенести на другой день, снять совсем, напомнить. Сданная:
 * открыть проверку. До этого правка плана была только массовой —
 * «проставить пачкой», — а живой месяц правится по одной строке:
 * заболел, заменили, сдвинули.
 *
 * Сданное правка плана не трогает: у выкладки со ссылками ролик уже
 * вышел, и «перенос» переписал бы историю периода задним числом. Это
 * правило держит сервер (409 publication_started), а не гашёная кнопка.
 *
 * Разметка перенесена из макета ~/tmp/prmarket-cabinets.html, блок «План
 * выкладок».
 */
@Component({
  selector: 'app-publication-plan',
  standalone: true,
  imports: [CommonModule, FormsModule, PrMarketAvaComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publication-plan.component.html',
  styleUrl: './publication-plan.component.scss',
})
export class PublicationPlanComponent {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  private readonly drawer = inject(NzDrawerService);

  public readonly projectId = input.required<string>();

  public readonly creators = input<readonly ProjectPerson[]>([]);

  /**
   * В проекте работают люди со стороны.
   *
   * Не то же самое, что «список креаторов пуст». Пустой состав у
   * проекта с креаторами значит «ещё никого не добавили», и план там
   * честно говорит «сначала соберите состав». У проекта без креаторов
   * состава не будет никогда: ролики выходят с аккаунтов бренда, и та
   * же надпись превращалась в тупик — даты проставить было НЕЧЕМ,
   * хотя и сервер, и заказчиков кабинет такой проект давно умеют.
   */
  public readonly crew = input<boolean>(true);

  public readonly publications = input<readonly Publication[]>([]);

  /**
   * Границы текущего периода, ГГГГ-ММ-ДД. Пусто — периода ещё нет.
   *
   * План — единственное место, где видно, ЧЕМ период кончается: месяц
   * считает календарь, а последнюю выкладку ставит человек. Без этой
   * метки менеджер подтверждает конец периода, не видя, что в него
   * попало.
   */
  public readonly periodStart = input<string>('');

  public readonly periodEnd = input<string>('');

  /** План поменялся — странице надо перечитать выкладки. */
  public readonly changed = output<void>();

  /** Открыть проверку ролика: она живёт отдельным блоком на той же странице. */
  public readonly review = output<string>();

  public readonly busy = signal(false);

  /**
   * На тач-экране правка клетки открывается нижним листом, на десктопе
   * остаётся строкой под таблицей.
   *
   * Проверяем устройство, а не ширину окна: у ноутбука с тачскрином
   * ширина десктопная, а палец всё равно палец. Читаем один раз при
   * создании — устройство по дороге не меняется.
   */
  public readonly touch = isTouchDevice();

  /** Показанный месяц, ГГГГ-ММ. */
  public readonly month = signal(this.monthKey(new Date()));

  public readonly monthTitle = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    const names = [
      'январь',
      'февраль',
      'март',
      'апрель',
      'май',
      'июнь',
      'июль',
      'август',
      'сентябрь',
      'октябрь',
      'ноябрь',
      'декабрь',
    ];
    return `${names[m - 1] ?? ''} ${y}`;
  });

  public readonly days = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    return Array.from({ length: total }, (_, i) => {
      const num = i + 1;
      const date = `${this.month()}-${String(num).padStart(2, '0')}`;
      return {
        num,
        date,
        weekend: WEEKEND.has(new Date(`${date}T00:00:00`).getDay()),
        periodEnd: date === this.periodEnd().slice(0, 10),
      };
    });
  });

  /**
   * Последняя выкладка периода — та, по которой период кончается на
   * деле. Считаем по плану, а не по календарю: она может стоять раньше
   * расчётной границы, и тогда менеджер подтверждает конец периода ею.
   */
  public readonly lastOfPeriod = computed(() => {
    const from = this.periodStart().slice(0, 10);
    const to = this.periodEnd().slice(0, 10);
    if (!from || !to) return '';
    const days = this.publications()
      .filter((p) => p.status !== 'cancelled')
      .map((p) => p.due_date.slice(0, 10))
      .filter((d) => d >= from && d <= to)
      .sort();
    return days.length ? days[days.length - 1] : '';
  });

  /**
   * Чьи это выкладки — ключ, по которому строится строка плана.
   *
   * У проекта без креаторов владельца нет вовсе (бэк не отдаёт поле), и
   * все выкладки складываются в одну строку проекта. Пустая строка как
   * ключ, а не выдуманный uuid: она и на сервере пустая.
   */
  private ownerOf(p: Publication): string {
    return p.creator_user_id || '';
  }

  /**
   * По кому строки плана: люди — или сам проект, если людей не бывает.
   *
   * Сетка «кто × день» без «кто» не вырождается в ничто: остаётся
   * ровно один ряд — ряд проекта. Так менеджер видит месяц теми же
   * глазами, что и у проекта с составом, и правит его теми же
   * клетками.
   */
  public readonly owners = computed<readonly ProjectPerson[]>(() =>
    this.crew() ? this.creators() : [PROJECT_ROW],
  );

  public readonly rows = computed<Row[]>(() => {
    const today = this.dayKey(new Date());
    const byKey = new Map<string, Publication[]>();
    for (const p of this.publications()) {
      if (p.status === 'cancelled') continue;
      const key = `${this.ownerOf(p)}|${p.due_date.slice(0, 10)}`;
      const list = byKey.get(key) ?? [];
      list.push(p);
      byKey.set(key, list);
    }
    // Внутри дня — по номеру: это порядок, в котором ролики заводили, и
    // он же порядок, в котором их видно в списке дня. Без сортировки
    // «Ролик 2» мог оказаться первым, и ссылаться на него голосом
    // («сними второй») стало бы нельзя.
    for (const list of byKey.values()) {
      list.sort((a, b) => (a.day_slot ?? 1) - (b.day_slot ?? 1));
    }

    return this.owners().map((person) => {
      const cells = this.days().map<Cell>((d) => {
        const pubs = byKey.get(`${person.user_id}|${d.date}`) ?? [];
        return {
          date: d.date,
          day: d.num,
          state: this.stateOf(pubs),
          today: d.date === today,
          weekend: d.weekend,
          periodEnd: d.periodEnd,
          lastOfPeriod: pubs.length > 0 && d.date === this.lastOfPeriod(),
          pubs,
          hint: this.hintOf(person.display_name, d.date, pubs),
        };
      });
      const mine = this.publications().filter(
        (p) => this.ownerOf(p) === person.user_id && p.status !== 'cancelled',
      );
      return {
        person,
        cells,
        nextOpen: [...mine]
          .filter((p) => p.status === 'planned' || p.status === 'partial')
          .sort((a, b) => a.due_date.localeCompare(b.due_date))[0],
        planned: mine.length,
        done: mine.filter((p) => p.status === 'done' || p.status === 'closed_manually').length,
        late: mine.filter((p) => p.overdue).length,
      };
    });
  });

  /** Состояние выкладки словом — для подсказки клетки и списка дня. */
  public stateWord(pub: Publication): string {
    if (pub.status === 'done') return 'вышел';
    if (pub.status === 'closed_manually') return 'закрыт вручную';
    if (pub.overdue) return 'просрочен';
    return pub.links.length ? 'сдан, ждёт проверки' : 'в плане';
  }

  /** Состояние одного ролика. */
  public stateOfPub(pub: Publication): Exclude<Cell['state'], ''> {
    if (pub.status === 'done' || pub.status === 'closed_manually') return 'd';
    if (pub.review && pub.review.status !== 'accepted' && pub.links.length) return 'r';
    if (pub.overdue) return 'l';
    return 'p';
  }

  /**
   * Порядок тревожности состояний: просрочка важнее проверки, проверка
   * важнее плана, план важнее готового.
   *
   * По нему клетка выбирает, что показать за весь день. Числом, а не
   * сравнением по месту в массиве: порядок — это решение, и оно должно
   * читаться одной строкой.
   */
  private static readonly ALARM: Record<Exclude<Cell['state'], ''>, number> = {
    l: 3,
    r: 2,
    p: 1,
    d: 0,
  };

  private stateOf(pubs: readonly Publication[]): Cell['state'] {
    let worst: Cell['state'] = '';
    for (const p of pubs) {
      const s = this.stateOfPub(p);
      if (worst === '' || PublicationPlanComponent.ALARM[s] > PublicationPlanComponent.ALARM[worst])
        worst = s;
    }
    return worst;
  }

  private hintOf(name: string, date: string, pubs: readonly Publication[]): string {
    const when = `${date.slice(8, 10)}.${date.slice(5, 7)}`;
    const tail = date === this.lastOfPeriod() ? ' · последняя выкладка периода' : '';
    if (!pubs.length) return `${name}, ${when} — свободно, поставить выкладку`;
    // Несколько роликов в дне: перечисляем состояния, иначе подсказка
    // про «просрочен» молчала бы о том, что рядом два вышедших.
    if (pubs.length > 1) {
      const words = pubs.map((p, i) => `${i + 1}) ${this.stateWord(p)}`).join(', ');
      return `${name}, ${when} — ${pubs.length} ролика: ${words}${tail}`;
    }
    return `${name}, ${when} — ${this.stateWord(pubs[0])}${tail}`;
  }

  // ---- выбранная клетка ----

  public readonly picked = signal<{ creator: ProjectPerson; cell: Cell } | null>(null);

  /**
   * Какой ролик дня правим. null — показываем список дня.
   *
   * Отдельно от picked, потому что это два разных вопроса: «какой день»
   * выбирают клеткой, «какой ролик в нём» — списком. Когда в дне ролик
   * один, список не нужен и ставится сразу он: лишний шаг на пути к
   * кнопке «Перенести» — это тот же план, только медленнее.
   */
  public readonly pickedPub = signal<Publication | null>(null);

  /** Куда переносим: дата в поле правки. */
  public moveTo = '';

  /**
   * На какой день ставим новую выкладку.
   *
   * Отдельно от moveTo: на телефоне сетки нет, клетку пальцем не
   * выбрать, и день набирается прямо в листе. На десктопе поле
   * подставлено из клетки, по которой нажали.
   */
  public addOn = '';

  /** Сегодня, ГГГГ-ММ-ДД: нижняя граница для полей даты. */
  public readonly today = this.dayKey(new Date());

  /**
   * Подпись под правкой клетки: кого эта правка касается.
   *
   * У проекта без креаторов «видна креатору сразу и уходит в бот» —
   * обещание, которое некому выполнить: адресата у поштучного письма
   * нет, и напоминания по такой выкладке складываются в дневную
   * сводку менеджерам (см. RunReminders на бэке).
   */
  public get editNote(): string {
    return this.crew()
      ? 'Правка плана видна креатору сразу и уходит в бот.'
      : 'Ролики выходят с аккаунтов бренда: личных напоминаний по ним нет, срыв срока попадёт в дневную сводку менеджерам.';
  }

  public pick(person: ProjectPerson, cell: Cell): void {
    const cur = this.picked();
    if (cur && cur.creator.user_id === person.user_id && cur.cell.date === cell.date) {
      this.picked.set(null);
      this.pickedPub.set(null);
      return;
    }
    this.picked.set({ creator: person, cell });
    this.pickedPub.set(cell.pubs.length === 1 ? cell.pubs[0] : null);
    this.moveTo = cell.date;
    this.addOn = cell.date < this.today ? this.today : cell.date;
  }

  /** Открыть правку одного ролика из списка дня. */
  public pickPub(pub: Publication): void {
    this.pickedPub.set(pub);
    this.moveTo = pub.due_date.slice(0, 10);
  }

  /** Вернуться из правки ролика к списку дня. */
  public backToDay(): void {
    this.pickedPub.set(null);
  }

  /** Подпись ролика в списке дня: «Ролик 2 · в плане». */
  public pubLabel(pub: Publication, index: number): string {
    return `Ролик ${pub.day_slot ?? index + 1} · ${this.stateWord(pub)}`;
  }

  /**
   * Открыть постановку на ближайший свободный день этого креатора.
   *
   * Нужна ленте на телефоне: там нарисованы только занятые дни, и
   * ткнуть в пустую клетку нельзя. Первое число месяца в прошлом, и
   * открывать редактор на нём значит показывать форму, которая заведомо
   * ответит отказом.
   */
  public pickFree(row: Row): void {
    const free =
      row.cells.find((c) => !c.pubs.length && c.date >= this.today) ??
      row.cells[row.cells.length - 1];
    this.pick(row.person, free);
    this.addOn = free.date < this.today ? this.today : free.date;
  }

  public close(): void {
    this.picked.set(null);
    this.pickedPub.set(null);
  }

  public shiftMonth(delta: number): void {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this.month.set(this.monthKey(d));
    this.picked.set(null);
    this.pickedPub.set(null);
  }

  // ---- действия ----

  /** Поставить выкладку на выбранный день. */
  public add(): void {
    const p = this.picked();
    if (!p || this.busy()) return;
    const day = this.addOn || p.cell.date;
    if (day < this.today) {
      this.msg.error('Выкладку ставят на сегодня или вперёд — выберите другой день.');
      return;
    }
    this.run(
      this.api.managerAddPublication(this.projectId(), p.creator.user_id, day),
      this.crew()
        ? `Поставили выкладку ${p.creator.display_name} на ${this.human(day)}.`
        : `Поставили выкладку на ${this.human(day)}.`,
    );
  }

  /**
   * Добавить в этот день ещё один ролик.
   *
   * Отдельно от add(): там дату выбирают полем, здесь она уже выбрана
   * клеткой, и поле было бы вопросом с единственным ответом. Номер в
   * дне ставит сервер — первый свободный.
   */
  public addMore(): void {
    const p = this.picked();
    if (!p || this.busy()) return;
    const day = p.cell.date;
    if (day < this.today) {
      this.msg.error('Этот день уже прошёл — ролики ставят на сегодня или вперёд.');
      return;
    }
    this.run(
      this.api.managerAddPublication(this.projectId(), p.creator.user_id, day),
      `Добавили ещё один ролик на ${this.human(day)}.`,
    );
  }

  /** Подпись выбранной клетки: кто, когда и сколько там роликов. */
  public cellTitle(sel: { creator: ProjectPerson; cell: Cell }): string {
    const head = `${sel.creator.display_name} · ${this.human(sel.cell.date)}`;
    const n = sel.cell.pubs.length;
    return n > 1 ? `${head} · ${n} ролика` : head;
  }

  /** Перенести плановую выкладку на другой день. */
  public move(): void {
    const pub = this.pickedPub();
    const p = this.picked();
    if (!p || !pub || this.busy()) return;
    if (!this.moveTo || this.moveTo === p.cell.date) {
      this.msg.error('Выберите новую дату — переносить на ту же нечего.');
      return;
    }
    this.run(
      this.api.managerMoveDueDate(pub.id, this.moveTo),
      `Перенесли на ${this.human(this.moveTo)}.`,
    );
  }

  /** Снять выкладку с плана. Причина обязательна: по ней видно дыру. */
  public cancel(): void {
    const p = this.picked();
    const pub = this.pickedPub();
    if (!p || !pub || this.busy()) return;
    this.modal.confirm({
      nzTitle: 'Снять выкладку с плана?',
      nzContent:
        `${p!.creator.display_name}, ${this.human(pub.due_date)}. ` +
        'Креатор увидит, что этого дня у него больше нет.',
      nzOkText: 'Снять',
      nzOkDanger: true,
      nzOnOk: () =>
        new Promise<void>((resolve) => {
          this.api.managerCancelPublication(pub.id, 'снято менеджером при правке плана').subscribe({
            next: () => {
              this.msg.success('Выкладку сняли с плана.');
              this.picked.set(null);
              this.changed.emit();
              resolve();
            },
            error: (e) => {
              this.msg.error(parseApiError(e, 'Не удалось снять выкладку.').message);
              resolve();
            },
          });
        }),
    });
  }

  /** Напомнить о ближайшей несданной выкладке этого креатора. */
  // ---- колокольчик «напомнить накануне» ----
  //
  // Это НЕ пинг. Пинг — разовое «напомни сейчас»; колокольчик говорит,
  // писать ли этому человеку каждый раз накануне срока. «Завтра срок» —
  // ещё рабочее напоминание, в отличие от «сегодня срок», когда снимать
  // и монтировать уже поздно.

  /**
   * Локальные переключения: состав приходит входом и сам не меняется, а
   * нажатие обязано отзываться сразу — по колокольчику щёлкают подряд
   * по всему списку.
   */
  private readonly bells = signal<Record<string, boolean>>({});

  public bellOn(row: Row): boolean {
    const local = this.bells()[row.person.user_id];
    return local ?? row.person.remind_day_before ?? false;
  }

  public toggleBell(row: Row): void {
    const next = !this.bellOn(row);
    const id = row.person.user_id;
    this.bells.set({ ...this.bells(), [id]: next });
    this.api.managerSetCreatorReminder(this.projectId(), id, next).subscribe({
      next: () =>
        this.msg.success(
          next
            ? `Напомним ${row.person.display_name} в бот за день до срока.`
            : `Напоминания ${row.person.display_name} выключены.`,
        ),
      error: (e) => {
        // Откат: колокольчик, который показывает не то, что на сервере,
        // хуже колокольчика, который не нажался.
        const back = { ...this.bells() };
        back[id] = !next;
        this.bells.set(back);
        this.msg.error(parseApiError(e, 'Не удалось изменить напоминание.').message);
      },
    });
  }

  /** «Обычно даёт столько-то» — медиана просмотров, если она есть. */
  public medianLabel(row: Row): string {
    const m = row.person.median;
    if (!m) return '';
    return `медиана ${this.shortViews(m.views)} по ${m.basis} роликам`;
  }

  private shortViews(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')} млн`;
    if (v >= 1_000) return `${Math.round(v / 1_000)} тыс.`;
    return String(v);
  }

  public remind(row: Row): void {
    const pub = row.nextOpen;
    if (!pub) {
      this.msg.info(`У ${row.person.display_name} нет несданных выкладок.`);
      return;
    }
    this.api.managerRemind(pub.id).subscribe({
      next: () => this.msg.success(`Напомнили: ${row.person.display_name}.`),
      error: (e) => {
        const err = parseApiError(e, 'Напоминание не ушло.');
        // 409 already_reminded — не отказ, а факт: сегодня по этой
        // выкладке бот уже написал. Красная плашка на этом месте
        // говорит «не получилось», хотя получилось ещё утром.
        if (err.code === 'already_reminded') {
          this.msg.info(`Сегодня ${row.person.display_name} уже напоминали — следующее завтра.`);
          return;
        }
        this.msg.error(err.message);
      },
    });
  }

  /**
   * Разовое «напомни сейчас» по ВЫБРАННОЙ выкладке.
   *
   * Не то же, что колокольчик: тот говорит, писать ли этому человеку
   * КАЖДЫЙ раз накануне срока. Здесь менеджер дёргает по одной, глядя
   * на конкретный день, — и до этой кнопки на десктопе дотянуться было
   * нечем: разовый пинг жил только в ленте телефона и в тревогах, где
   * он шлёт всем просроченным сразу.
   */
  public remindPicked(): void {
    const sel = this.picked();
    const pub = this.pickedPub();
    if (!sel || !pub) return;
    this.busy.set(true);
    this.api.managerRemind(pub.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.msg.success(`Напомнили: ${sel.creator.display_name}.`);
      },
      error: (e) => {
        this.busy.set(false);
        const err = parseApiError(e, 'Напоминание не ушло.');
        // 409 already_reminded — не отказ, а факт: сегодня по этой
        // выкладке бот уже написал.
        if (err.code === 'already_reminded') {
          this.msg.info(`Сегодня ${sel.creator.display_name} уже напоминали — следующее завтра.`);
          return;
        }
        this.msg.error(err.message);
      },
    });
  }

  public openReview(): void {
    const pub = this.pickedPub();
    if (pub) this.review.emit(pub.id);
  }

  /** Массовая простановка — там, где план ставят на месяц вперёд. */
  public openSchedule(): void {
    const data: SchedulePublicationsData = {
      projectID: this.projectId(),
      creators: this.creators().map((c) => ({
        user_id: c.user_id,
        display_name: c.display_name,
      })),
      crew: this.crew(),
      draftRequired: true,
      existing: this.publications().map((p) => ({
        creator_user_id: p.creator_user_id,
        due_date: p.due_date,
        status: p.status,
      })),
    };
    // На тач-экране — нижняя шторка, на десктопе окно. Содержимое одно
    // и то же: календарь месяца, заготовки расписания и срок черновика.
    // Шторка не ради вида: окно по центру на телефоне открывается далеко
    // от большого пальца, а закрывается крестиком в углу.
    // Ширина, а не только устройство ввода: окно с календарём месяца в
    // узкое окно браузера не помещается так же, как в телефон.
    if (prefersSheet()) {
      this.drawer
        .create<SchedulePublicationsDialogComponent, SchedulePublicationsData, unknown>({
          nzTitle: 'Проставить даты выкладок',
          nzContent: SchedulePublicationsDialogComponent,
          nzData: data,
          nzPlacement: 'bottom',
          nzHeight: '88%',
          nzBodyStyle: { padding: '0 16px 24px' },
        })
        .afterClose.subscribe((res) => this.afterSchedule(res));
      return;
    }
    this.modal
      .create({
        nzTitle: 'Проставить даты выкладок',
        nzContent: SchedulePublicationsDialogComponent,
        nzData: data,
        nzFooter: null,
        nzWidth: 560,
      })
      .afterClose.subscribe((res) => this.afterSchedule(res));
  }

  /**
   * Что делаем после простановки пачкой: перечитываем план И
   * переключаем сетку на месяц, в котором выкладки завелись.
   *
   * Без переключения это выглядит как «ничего не произошло»: даты
   * ставят на следующий месяц, а сетка остаётся на текущем — там не
   * меняется ни одна клетка. Человек жмёт обновление страницы, видит
   * ровно то же самое и решает, что кнопка сломана. Данные при этом
   * приходят исправно, просто показываем мы другой месяц.
   */
  private afterSchedule(res: unknown): void {
    if (!res) return;
    this.changed.emit();
    // Месяц берём ИЗ ОКНА — тот, что человек видел в календаре, когда
    // отмечал дни. По самой ранней созданной дате считать нельзя: пачка
    // достаёт и тех, кому этот день ставили раньше, и «самой ранней»
    // оказывается чужая дата из прошлого месяца — сетка осталась бы на
    // месте, то есть ровно в том состоянии, из-за которого всё и
    // затевалось.
    const month = (res as { month?: string }).month;
    if (month && month !== this.month()) {
      this.month.set(month);
      this.picked.set(null);
    }
  }

  private run(req: ReturnType<PublicationApi['managerAddPublication']>, ok: string): void {
    this.busy.set(true);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.picked.set(null);
        this.pickedPub.set(null);
        this.msg.success(ok);
        this.changed.emit();
      },
      error: (e) => {
        this.busy.set(false);
        // Отказы приходят с готовым текстом: «на эту дату у креатора уже
        // есть выкладка», «период подытожен». Показываем его, а не свой
        // пересказ — он точнее.
        this.msg.error(parseApiError(e, 'Не удалось изменить план.').message);
      },
    });
  }

  public human(date: string): string {
    return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private dayKey(d: Date): string {
    return `${this.monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
