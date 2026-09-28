import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { panelData, panelRef } from '@shared/lib/panel';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ProjectSettings } from '@entities/publication/model/publication.types';
import { BatchRequest } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';

export interface ScheduleCreator {
  user_id: string;
  display_name: string;
}

/** Уже стоящая в плане выкладка — ровно то, от чего зависит окно. */
export interface ScheduledPublication {
  creator_user_id: string;
  /** ГГГГ-ММ-ДД или ISO — берём первые десять символов. */
  due_date: string;
  status: string;
}

export interface SchedulePublicationsData {
  projectID: string;
  creators: ScheduleCreator[];
  /**
   * В проекте работают люди со стороны.
   *
   * Не выводится из пустого списка креаторов: пустой состав у проекта
   * с креаторами значит «ещё никого не добавили», и тогда спрашивать
   * «кому» правильно. У проекта без креаторов спрашивать некого
   * никогда — ролик принадлежит проекту, — и вопрос «Кому» вместе с
   * проверкой «выберите хотя бы одного» закрывал единственный способ
   * проставить такому проекту даты.
   */
  crew: boolean;
  // У проекта включён этап согласования черновика: тогда имеет смысл
  // спрашивать, за сколько дней до выкладки сдавать черновик.
  draftRequired: boolean;
  /**
   * Что уже стоит в плане.
   *
   * Без этого окно открывалось чистым, и менеджер, открывший его второй
   * раз, видел пустой календарь вместо своего плана. Дальше он отмечал
   * даты заново — и получал не исправленный план, а старый плюс новый.
   */
  existing: ScheduledPublication[];
}

/** Заготовки расписания: то, чем реально пользуются. */
type Preset = 'tue_thu' | 'mon_wed_fri' | 'every2' | 'clear';

const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

const MONTHS = [
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

/** ГГГГ-ММ-ДД в локальном времени: toISOString сдвигает дату на UTC. */
function key(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Массовая простановка дат выкладок.
 *
 * Тридцать штук по одной завести нельзя, поэтому единственный путь —
 * пачка. Даты выбираются календарём поимённо, а не диапазоном со схемой:
 * заготовки («Вт и Чт») ставят галочки, а дальше их правят руками —
 * праздники и съёмочные дни в схему не укладываются.
 *
 * Окно открывается НА ТЕКУЩЕМ ПЛАНЕ, а не пустым. Пустое окно человек
 * читает как «плана нет» и набирает даты заново — а на сервере они
 * складываются с уже стоящими, и вместо исправленного плана выходит
 * старый плюс новый. Теперь стоящие даты отмечены сразу и подписаны,
 * сколько выкладок реально добавится.
 *
 * Снять уже стоящую дату отсюда нельзя, и окно про это говорит: ручки,
 * которая отменяет одну запланированную выкладку, у API пока нет —
 * есть только «закрыть с причиной» в её собственной строке. Молча
 * снимать галочку и ничего не делать было бы хуже всего: человек уйдёт
 * уверенный, что дату убрал.
 *
 * Разметка перенесена из макета ~/tmp/crm_project_manager (1).html.
 */
@Component({
  selector: 'app-schedule-publications-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="crm-page form" (submit)="$event.preventDefault(); create()">
      @if (data.crew) {
        <p class="lbl">Кому</p>
        <div class="pickchips crew">
          @for (c of data.creators; track c.user_id) {
            <button
              type="button"
              class="pick"
              [class.on]="isPicked(c.user_id)"
              (click)="togglePicked(c.user_id)"
            >
              <span class="av a2">{{ c.display_name.charAt(0) }}</span>
              {{ c.display_name }}
            </button>
          } @empty {
            <p class="hint">В проекте нет креаторов — сначала добавьте состав.</p>
          }
        </div>
      } @else {
        <p class="hint">
          Ролики выходят с аккаунтов бренда — выбирать некого. Отметьте дни, и выкладки встанут на
          сам проект.
        </p>
      }

      <div class="monthbar">
        <p class="lbl">Дни выкладки — {{ monthTitle() }}</p>
        <span class="nav">
          <button type="button" class="btn quiet sm" (click)="shiftMonth(-1)" aria-label="Назад">
            ‹
          </button>
          <button type="button" class="btn quiet sm" (click)="shiftMonth(1)" aria-label="Вперёд">
            ›
          </button>
        </span>
      </div>

      <div class="presets">
        <button type="button" class="btn quiet sm" (click)="preset('tue_thu')">Вт и Чт</button>
        <button type="button" class="btn quiet sm" (click)="preset('mon_wed_fri')">
          Пн, Ср, Пт
        </button>
        <button type="button" class="btn quiet sm" (click)="preset('every2')">Через день</button>
        <button type="button" class="btn quiet sm" (click)="preset('clear')">Сбросить</button>
      </div>

      <div class="mcal">
        @for (w of weekdays; track w) {
          <span class="dw">{{ w }}</span>
        }
        @for (c of cells(); track c.id) {
          @if (c.date) {
            <button
              type="button"
              class="dc"
              [class.sel]="isDay(c.date)"
              [class.past]="c.past"
              [class.set]="isLocked(c.date)"
              [class.part]="isPartial(c.date)"
              [attr.title]="isLocked(c.date) ? 'Уже в плане' : null"
              (click)="toggleDay(c.date)"
            >
              {{ c.day }}
            </button>
          } @else {
            <span class="dc pad"></span>
          }
        }
      </div>

      <!-- Этап черновика спрашивается ЗДЕСЬ и только здесь.
           Со страницы проекта тумблер убран: решение принимают ровно в
           этот момент — когда видно, на какие дни встанут сроки, — а не
           заранее в настройках, куда за ним отдельно идти. Настройка при
           этом проектная: выключили — у новых выкладок останется одна
           дата, уже проставленные сроки не стираются. -->
      <!-- Черновик сдаёт креатор, а принимает менеджер. У проекта, где
           ролики выходят с аккаунтов бренда, сдавать его некому, и
           второй срок был бы датой, к которой никто ничего не должен. -->
      @if (data.crew) {
        <div class="switchrow">
          <span class="tx">
            <b>Этап согласования черновика</b>
            <span>
              @if (draftOn()) {
                Два срока: сдать черновик за {{ draftLeadDays }}
                {{ draftLeadDays === 1 ? 'день' : 'дня' }} до выкладки и выложить. Бот пингует по
                первому.
              } @else {
                Один срок — дата выкладки. Уже проставленные сроки черновика останутся как есть.
              }
            </span>
          </span>
          @if (draftOn()) {
            <input
              class="lead"
              type="number"
              min="0"
              max="30"
              [(ngModel)]="draftLeadDays"
              name="lead"
            />
          }
          <button
            type="button"
            class="sw"
            [class.on]="draftOn()"
            [attr.aria-pressed]="draftOn()"
            (click)="toggleDraft()"
            aria-label="Этап согласования черновика"
          ></button>
        </div>
      }

      <!-- Считаем то, что добавится, а не «люди × дни»: почти всё в этом
           произведении уже стоит в плане, и обещать 60 там, где заведётся
           4, значит соврать про объём работы. -->
      <div class="summarybar">
        <b>{{ toCreate() }}</b>
        <span class="muted">{{ toCreate() === 1 ? 'новая выкладка' : 'новых выкладок' }}</span>
        @if (alreadySet()) {
          <span class="muted">· {{ alreadySet() }} уже в плане</span>
        }
        @if (data.crew && !picked().size) {
          <span class="muted">— отметьте, кому ставим даты</span>
        } @else if (!days().size) {
          <span class="muted">— отметьте дни в календаре</span>
        }
      </div>

      @if (alreadySet()) {
        <p class="hint">
          Отмеченные даты — это текущий план. Новые добавятся к нему, а стоящие останутся как есть:
          убрать запланированную выкладку можно только из её строки в списке.
        </p>
      }

      <div class="actions">
        <button type="button" class="btn ghost sm" (click)="cancel()">Отмена</button>
        <button type="submit" class="btn primary sm" [disabled]="!toCreate() || busy()">
          {{ alreadySet() ? 'Добавить даты' : 'Создать выкладки' }}
        </button>
      </div>
    </form>
  `,
  styles: [
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .crew {
        margin-bottom: 6px;
      }
      .monthbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .monthbar .lbl {
        margin: 0;
      }
      .nav {
        display: flex;
        gap: 6px;
      }
      .lead {
        width: 62px;
        padding: 8px 10px;
        border: 1px solid var(--border-strong, #2c313a);
        border-radius: var(--r-field, 10px);
        background: var(--bg-elevated, #111316);
        color: var(--text);
        font-family: inherit;
        text-align: center;
      }
      .hint {
        margin: 0;
        color: var(--text-muted);
        font-size: 12.5px;
      }
      /* Уже стоящая дата отличается от только что отмеченной: первую
         отсюда не снять, и выглядеть они одинаково не должны. */
      .dc.set {
        border-style: dashed;
        cursor: default;
        opacity: 0.85;
      }
      .dc.part::after {
        position: absolute;
        right: 4px;
        bottom: 3px;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentcolor;
        content: '';
      }
      .dc.part {
        position: relative;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    `,
  ],
})
export class SchedulePublicationsDialogComponent {
  // Окно на десктопе, нижняя шторка на телефоне — см. shared/lib/panel.
  private readonly panel = panelRef();

  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly data = panelData<SchedulePublicationsData>();

  private closeWith(result?: unknown): void {
    this.panel.close(result);
  }

  public readonly weekdays = WEEKDAYS;

  /**
   * Что уже стоит в плане: дата → кто на неё назначен.
   *
   * Отменённые не в счёт — их дата свободна, и ставить её заново можно.
   */
  private readonly scheduled = new Map<string, Set<string>>(
    (() => {
      const out = new Map<string, Set<string>>();
      for (const p of panelData<SchedulePublicationsData>().existing ?? []) {
        if (p.status === 'cancelled') continue;
        const day = p.due_date.slice(0, 10);
        const set = out.get(day) ?? new Set<string>();
        // У проекта без креаторов владельца нет: ключом идёт та же
        // пустая строка, что и в picked() ниже.
        set.add(p.creator_user_id ?? '');
        out.set(day, set);
      }
      return out;
    })(),
  );

  public readonly picked = signal<Set<string>>(new Set());

  /** Выбранные дни, ключами ГГГГ-ММ-ДД — порядок задаём при отправке. */
  public readonly days = signal<Set<string>>(new Set());

  public readonly busy = signal(false);

  /**
   * Этап черновика включён. Начальное значение — настройка ПРОЕКТА:
   * окно не заводит свою правду о том же, а показывает записанную и
   * позволяет её изменить.
   *
   * data.draftRequired — только подсказка на первые миллисекунды; как
   * приедут настройки проекта, берём их (если человек к тумблеру ещё не
   * притронулся — переключать под рукой нельзя).
   */
  public readonly draftOn = signal(panelData<SchedulePublicationsData>().draftRequired);

  /** Нынешние настройки проекта целиком. */
  private readonly settings = signal<ProjectSettings | null>(null);

  /** Тумблер трогали руками — не перетирать ответом сервера. */
  private draftTouched = false;

  public toggleDraft(): void {
    this.draftTouched = true;
    this.draftOn.set(!this.draftOn());
  }

  public draftLeadDays = 2;

  /** Какой месяц показан в календаре. Проект живёт дольше одного. */
  private readonly cursor = signal(startOfMonth(new Date()));

  public constructor() {
    // Открываемся на текущем плане: отмечены те, кому уже проставлены
    // даты, и сами даты. Плана нет — всё пусто, как и было.
    // У проекта без креаторов отмечать некого, но считать надо: ряд
    // один, и это ряд проекта. Пустая строка — тот же «никто», что
    // лежит в базе у таких выкладок.
    const creators = new Set<string>(this.data.crew ? [] : ['']);
    if (this.data.crew) {
      for (const ids of this.scheduled.values()) for (const id of ids) creators.add(id);
    }
    this.picked.set(creators);
    this.days.set(new Set(this.scheduled.keys()));
    // И на том месяце, где план начинается: открывать сентябрь, когда
    // выкладки стоят в октябре, значит показать пустой календарь поверх
    // непустого плана.
    const first = [...this.scheduled.keys()].sort()[0];
    if (first) {
      const [y, m] = first.split('-').map(Number);
      this.showMonth(y, m - 1);
    }

    // Настройки проекта — ради этапа черновика: тумблер здесь правит
    // ПРОЕКТ, а не эту пачку, и открываться он обязан на том значении,
    // которое записано. Заодно они нужны при сохранении: ручка заменяет
    // настройки целиком.
    this.api.managerProjectSettings(this.data.projectID).subscribe({
      next: (st) => {
        this.settings.set(st);
        if (!this.draftTouched) this.draftOn.set(st.draft_required);
      },
      // Молча: не прочитали — тумблер остаётся на подсказке из data, а
      // сохранять настройку без прочитанных мы всё равно не станем.
      error: () => this.settings.set(null),
    });
  }

  /** Открыть календарь на заданном месяце. Номер месяца с нуля. */
  public showMonth(year: number, month: number): void {
    this.cursor.set(new Date(year, month, 1));
  }

  public readonly monthTitle = computed(() => {
    const d = this.cursor();
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  });

  /**
   * Клетки месяца: пустышки до первого числа, чтобы числа встали под
   * своими днями недели, и сами дни. Прошедшие выключены — выкладку
   * задним числом не планируют.
   */
  public readonly cells = computed(() => {
    const first = this.cursor();
    const today = startOfDay(new Date());
    // getDay(): воскресенье — 0, а неделя у нас с понедельника.
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const out: { id: string; day: number; date: string | null; past: boolean }[] = [];
    for (let i = 0; i < lead; i += 1) out.push({ id: `pad${i}`, day: 0, date: null, past: false });
    for (let d = 1; d <= total; d += 1) {
      const date = new Date(first.getFullYear(), first.getMonth(), d);
      out.push({ id: key(date), day: d, date: key(date), past: date < today });
    }
    return out;
  });

  public readonly total = computed(() => this.picked().size * this.days().size);

  /**
   * Сколько выкладок реально добавится.
   *
   * Не «креаторы × дни»: почти всё в этом произведении уже стоит в
   * плане, и сервер такие пары молча пропускает (ON CONFLICT по паре
   * «креатор и день»). Показывать 60 там, где заведётся 4, значит
   * обещать работу, которой не будет.
   */
  public readonly toCreate = computed(() => {
    let n = 0;
    for (const day of this.days()) {
      const already = this.scheduled.get(day);
      for (const id of this.picked()) if (!already?.has(id)) n += 1;
    }
    return n;
  });

  /** Сколько из отмеченного уже стоит: то, что останется как есть. */
  public readonly alreadySet = computed(() => this.total() - this.toCreate());

  /**
   * На дате уже есть выкладки — галочка с неё не снимается.
   *
   * Снять её было бы нечем: ручки, отменяющей одну запланированную
   * выкладку, у API нет. Хватает ОДНОЙ существующей выкладки, а не всех
   * отмеченных: снятая галочка всё равно ничего не отменит, а человек
   * уйдёт уверенный, что дату убрал.
   */
  public isLocked(date: string): boolean {
    return this.scheduled.has(date);
  }

  /** Дата есть, но не у всех отмеченных: кому-то её ещё добавят. */
  public isPartial(date: string): boolean {
    const already = this.scheduled.get(date);
    if (!already) return false;
    for (const id of this.picked()) if (!already.has(id)) return true;
    return false;
  }

  public isPicked(id: string): boolean {
    return this.picked().has(id);
  }

  public togglePicked(id: string): void {
    this.picked.set(toggled(this.picked(), id));
  }

  public isDay(date: string): boolean {
    return this.days().has(date);
  }

  public toggleDay(date: string): void {
    // Снять стоящую дату отсюда нельзя: ручки, отменяющей одну
    // запланированную выкладку, у API нет. Галочка, которая снимается и
    // ничего не меняет, — обещание, которого мы не выполним.
    if (this.isLocked(date)) {
      this.msg.info('Дата уже в плане. Убрать её можно только из строки самой выкладки.');
      return;
    }
    this.days.set(toggled(this.days(), date));
  }

  public shiftMonth(delta: number): void {
    const d = this.cursor();
    this.cursor.set(new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  /**
   * Заготовка ставит галочки в показанном месяце, не трогая другие:
   * проект на два месяца собирают по месяцу за раз, и «Вт и Чт» во втором
   * не должно стирать выбранное в первом.
   */
  public preset(p: Preset): void {
    const next = new Set(this.days());
    // Занятые даты заготовка не трогает ни в какую сторону: «Сбросить»
    // не снимает того, что уже стоит в плане, — снять это отсюда нечем.
    const month = this.cells().filter((c) => c.date && !c.past && !this.isLocked(c.date));
    for (const c of month) next.delete(c.date!);
    if (p === 'clear') {
      this.days.set(next);
      return;
    }
    for (const c of month) {
      // Из компонентов клетки, а не new Date(строка): строка «ГГГГ-ММ-ДД»
      // разбирается как полночь UTC, и в минусовых часовых поясах день
      // недели уезжает на сутки назад — «Вт и Чт» проставились бы в
      // понедельник и среду.
      const [y, m, day] = c.date!.split('-').map(Number);
      const dow = new Date(y, m - 1, day).getDay();
      const hit =
        p === 'tue_thu'
          ? dow === 2 || dow === 4
          : p === 'mon_wed_fri'
            ? dow === 1 || dow === 3 || dow === 5
            : day % 2 === 1;
      if (hit) next.add(c.date!);
    }
    this.days.set(next);
  }

  public create(): void {
    if (this.data.crew && !this.picked().size) {
      this.msg.error('Выберите хотя бы одного креатора.');
      return;
    }
    if (!this.days().size) {
      this.msg.error('Отметьте дни выкладок в календаре.');
      return;
    }
    if (!this.toCreate()) {
      this.msg.info('Всё отмеченное уже стоит в плане — добавлять нечего.');
      return;
    }
    // Шлём набор целиком, а не только новые пары: уже стоящие сервер
    // пропускает сам, и список дат в запросе остаётся тем же планом,
    // который менеджер видит на экране.
    const req: BatchRequest = {
      // Список людей у проекта без креаторов пуст, и это не забытое
      // поле: сервер по нему и отличает «пачку на проект» от «пачки
      // людям» (см. CreateBatch → HasCrew). Пустая строка из picked()
      // туда не едет — это наш внутренний ключ ряда, а не uuid.
      creator_user_ids: this.data.crew ? [...this.picked()] : [],
      dates: [...this.days()].sort(),
      draft_lead_days: this.draftOn() ? Number(this.draftLeadDays) || 0 : 0,
    };
    this.busy.set(true);
    this.api.managerCreateBatch(this.data.projectID, req).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.msg.success(`Создано выкладок: ${res.created}`);
        // Тумблер переключили — значит решение про этап черновика
        // приняли сейчас, и оно относится ко всему проекту, а не к этой
        // пачке. Сохраняем ПОСЛЕ создания и молча: выкладки уже стоят, и
        // отказ на настройке не должен выглядеть так, будто не стоят.
        const cur = this.settings();
        if (cur && cur.draft_required !== this.draftOn()) {
          // Настройки шлём ЦЕЛИКОМ: ручка заменяет их полностью, и
          // отправка одного поля молча выключила бы заказчику показ
          // статистики. Поэтому и читаем их сперва — без прочитанных
          // настроек сохранять нельзя.
          this.api
            .managerSaveProjectSettings(this.data.projectID, {
              ...cur,
              draft_required: this.draftOn(),
            })
            .subscribe({
              error: () =>
                this.msg.error('Выкладки созданы, но настройку черновика сохранить не удалось.'),
            });
        }
        // Возвращаем и МЕСЯЦ, который человек видел в календаре: план
        // за окном переключится на него и покажет результат. Считать
        // месяц по самой ранней созданной дате нельзя — пачка достаёт и
        // тех, кому этот день ставили раньше, и «самой ранней»
        // оказывается чужая дата из прошлого месяца.
        this.closeWith({ ...res, month: this.monthKey(this.cursor()) });
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось создать выкладки.').message);
      },
    });
  }

  /** «2026-10» из даты: тем же ключом живёт месяц в плане за окном. */
  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  public cancel(): void {
    this.closeWith();
  }
}

function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
