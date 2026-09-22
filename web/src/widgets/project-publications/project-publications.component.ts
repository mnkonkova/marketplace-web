import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { OrderApi } from '@entities/order/api/order.api';
import type { Order, OrderCandidate } from '@entities/order/model/order.types';
import { CANDIDATE_STATUS_LABEL, candidateTone, freeSlots } from '@entities/order/lib/order-status';
import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  ALL_PLATFORMS,
  Platform,
  ProjectPerson,
  ProjectSettings,
  Publication,
  PublicationReport,
  SubmittedLink,
  VideoRow,
} from '@entities/publication/model/publication.types';
import {
  PLATFORM_LABEL,
  PLATFORM_SHORT,
  canSubmitLinks,
  closedCount,
  creatorLabel,
  daysLeft,
  dueLabel,
  linkFor,
  linksCollected,
  missingPlatforms,
  publicationBadge,
} from '@entities/publication/lib/publication-status';
import { isSelfAdded } from '@entities/publication/lib/extra-publication';
import { projectBlocks } from '@entities/publication/lib/project-blocks';
import { ProjectKind } from '@entities/project/model/project.types';
import { downloadBlob } from '@shared/lib/download-blob';
import { plural } from '@shared/lib/format';
import { specialistHandle } from '@shared/lib/specialist-link';
import { profileHandle } from '@shared/lib/social-links';
import {
  AddCreatorDialogComponent,
  AddCreatorDialogData,
} from '@features/project-creators/add-creator.dialog';
import {
  SchedulePublicationsData,
  SchedulePublicationsDialogComponent,
} from '@features/schedule-publications/schedule-publications.dialog';
import { parseApiError } from '@shared/api/api-error';
import { ProjectAutopingComponent } from '@widgets/project-autoping/project-autoping.component';
import { ProjectChecklistComponent } from '@widgets/project-checklist/project-checklist.component';
import { ProjectStatsComponent } from '@widgets/project-stats/project-stats.component';
import { ErValueComponent } from '@shared/ui/er-value/er-value.component';
import { NodataComponent } from '@shared/ui/nodata/nodata.component';
import { StepsComponent } from '@shared/ui/steps/steps.component';

// Цвет аватара — от человека, а не случайный: одно и то же имя должно
// выглядеть одинаково на всех экранах и между перезагрузками.
function avatarClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `a${(h % 5) + 1}`;
}

// Выкладки проекта глазами менеджера: расписание, состав, напоминания,
// ручное закрытие и отчёт. Вынесено из страницы отдельным виджетом —
// на странице это половина разметки и стилей, и вместе они выходили за
// бюджет CSS-файла.
@Component({
  selector: 'app-project-publications',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzInputModule,
    NzTagModule,
    ProjectAutopingComponent,
    ProjectChecklistComponent,
    ProjectStatsComponent,
    ErValueComponent,
    StepsComponent,
    NodataComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-publications.component.html',
  styleUrls: [
    './project-publications.component.scss',
    './project-publications.component.touch.scss',
  ],
})
export class ProjectPublicationsComponent {
  private readonly pubApi = inject(PublicationApi);

  private readonly orderApi = inject(OrderApi);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  public readonly projectID = input.required<string>();

  // Вид проекта приходит с карточкой. Раньше блоки включались догадкой
  // «есть выкладки — значит проект про выкладки», и новый проект без
  // проставленных дат выглядел как проект по воронке.
  public readonly kind = input<ProjectKind>('creators_turnkey');

  /**
   * Какую часть виджета показывать.
   *
   * У менеджера проект разложен по вкладкам, и одна и та же лента целиком
   * там не нужна: план выкладок, состав и статистика живут на разных
   * экранах. 'all' — прежнее поведение, когда вкладок нет.
   */
  public readonly section = input<'all' | 'plan' | 'crew' | 'stats' | 'mat'>('all');

  /** Показывать ли раздел: 'all' показывает всё. */
  public shows(part: 'plan' | 'crew' | 'stats' | 'mat'): boolean {
    const s = this.section();
    return s === 'all' || s === part;
  }

  public constructor() {
    // Проект на странице может смениться без пересоздания виджета
    // (переход с проекта на проект тем же маршрутом) — перечитываем.
    effect(() => {
      const id = this.projectID();
      // kind читается как зависимость: он приезжает вместе с проектом,
      // то есть позже первого прохода эффекта.
      this.kind();
      if (id) this.loadPublications(id);
    });
  }

  // ---- выкладки проекта ----
  //
  // Блоки живут только у проектов «креаторы под ключ»: у остальных ручка
  // выкладок отдаёт пустой список, и рисовать нечего. Поля kind в DTO
  // проекта нет, поэтому решаем по данным.

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly platforms = ALL_PLATFORMS;

  public readonly pubs = signal<Publication[]>([]);

  // Действующий состав проекта: имена, дата включения и ссылки на
  // аккаунты по пяти площадкам. Собирать его из выкладок, как раньше,
  // больше не нужно — и не получалось: креатор без единой выкладки в
  // такой список не попадал вовсе.
  public readonly crew = signal<ProjectPerson[]>([]);

  // ---- очередь приглашений ----
  //
  // Клиент присылал ПРИОРИТЕТ, а не список: приглашения уходят сверху
  // вниз, по одному на свободное место. В составе человек оказался не
  // потому, что его выбрали, а потому, что до него дошла очередь, — и
  // без этой карточки менеджеру непонятно, почему в проекте четвёртый по
  // счёту. Проект, заведённый руками, из заказа не рос: заказа нет, и
  // блока тоже нет — пустая карточка врала бы, что очередь пуста.
  public readonly order = signal<Order | null>(null);

  public readonly orderBusy = signal(false);

  /**
   * Очередь по приоритету.
   *
   * Сортируем сами, хотя сервер и отдаёт ORDER BY priority: порядок строк
   * здесь — это порядок приглашений, и если он однажды приедет другим,
   * экран должен остаться правым, а не молча показать «позвали не того».
   */
  public readonly queue = computed<OrderCandidate[]>(() =>
    [...(this.order()?.candidates ?? [])].sort((a, b) => a.priority - b.priority),
  );

  public readonly orderFreeSlots = computed(() => {
    const o = this.order();
    return o ? freeSlots(o) : 0;
  });

  /**
   * Звать следующего можно, только когда есть КУДА и есть КОГО.
   *
   * Обычно очередь двигается сама: отказ и сгоревшее приглашение сразу
   * отдают место следующему. Кнопка нужна там, где двигать было нечего —
   * например, заказ остался черновиком и приглашения не ушли вовсе.
   */
  public readonly canInviteNext = computed(() => {
    const o = this.order();
    if (!o) return false;
    if (o.status !== 'draft' && o.status !== 'inviting') return false;
    return this.orderFreeSlots() > 0 && o.reserve_left > 0;
  });

  public readonly candidateLabel = CANDIDATE_STATUS_LABEL;

  public candidateTone(status: OrderCandidate['status']): string {
    return candidateTone(status);
  }

  // Аватар и буква у строки очереди те же, что у карточки состава: это
  // один и тот же человек, и узнавать его надо с одного взгляда.
  public avatar(userId: string): string {
    return avatarClass(userId);
  }

  public initial(name?: string): string {
    return creatorLabel(name).charAt(0).toUpperCase();
  }

  public inviteNext(): void {
    const o = this.order();
    if (!o || this.orderBusy()) return;
    this.orderBusy.set(true);
    this.orderApi.managerInvite(o.id).subscribe({
      next: (updated) => {
        this.orderBusy.set(false);
        this.order.set(updated);
        this.msg.success('Приглашение ушло следующему по приоритету');
      },
      error: (e) => {
        this.orderBusy.set(false);
        const err = parseApiError(e, 'Не удалось позвать следующего.');
        // Место могли занять, пока страница висела открытой. Показываем
        // причину и перечитываем заказ — иначе человек будет жать снова.
        if (err.code === 'no_free_slot') this.loadOrder(this.projectID());
        this.msg.error(err.message);
      },
    });
  }

  private loadOrder(id: string): void {
    this.orderApi.managerProjectOrder(id).subscribe({
      next: (o) => this.order.set(o),
      // 404 — проект завели руками, заказа не было. Это не ошибка и
      // сообщения не требует: блока просто не будет.
      error: () => this.order.set(null),
    });
  }

  public readonly report = signal<PublicationReport | null>(null);

  public readonly pubBusy = signal<string | null>(null);

  public readonly blocks = computed(() =>
    projectBlocks('manager', { kind: this.kind(), statsAllowed: true }),
  );

  /**
   * План — только действующие выкладки.
   *
   * Отменённая строка ничего не ждёт и ничего не значит: её сняли с
   * плана. В ленте они шли вперемешку с живыми, дублируя каждую дату
   * («11.09 отменена», «11.09 назначено»), сбивали нумерацию и делали
   * план вдвое длиннее — прочесть, что на самом деле нужно сдать, было
   * нельзя. Сколько их было, показываем строкой под планом.
   */
  public readonly ordered = computed(() =>
    this.pubs()
      .filter((p) => p.status !== 'cancelled')
      .sort((a, b) => a.due_date.localeCompare(b.due_date)),
  );

  public readonly cancelledCount = computed(
    () => this.pubs().filter((p) => p.status === 'cancelled').length,
  );

  // Горящие: просроченные и вышедшие не на всех площадках. Именно из них
  // собирается плашка «N выкладок горят» и адресный автопинг.
  public readonly burning = computed(() =>
    this.ordered().filter((p) => p.overdue || (p.status === 'partial' && !p.pending_date_request)),
  );

  public readonly pendingRequests = computed(() =>
    this.ordered().filter((p) => !!p.pending_date_request),
  );

  public readonly closedPubs = computed(() => closedCount(this.pubs()));

  public readonly livePubs = computed(
    () => this.pubs().filter((p) => p.status !== 'cancelled').length,
  );

  public readonly collected = computed(() => linksCollected(this.pubs()));

  // Строка ростера: человек из состава плюс его счётчики по выкладкам.
  // Считаем здесь, а не в шаблоне: те же цифры нужны и группам плана, и
  // карточкам состава, и разъезжаться им нельзя.
  public readonly creators = computed(() => {
    const rows = new Map<string, Publication[]>();
    for (const p of this.pubs()) {
      if (p.status === 'cancelled') continue;
      const list = rows.get(p.creator_user_id);
      if (list) list.push(p);
      else rows.set(p.creator_user_id, [p]);
    }
    const views = new Map(
      (this.report()?.by_creator ?? []).map((r) => [r.creator_user_id, r.views] as const),
    );
    return this.crew().map((p) => {
      const mine = rows.get(p.user_id) ?? [];
      const name = creatorLabel(p.display_name);
      return {
        user_id: p.user_id,
        display_name: name,
        initial: name.charAt(0).toUpperCase(),
        avatar: avatarClass(p.user_id),
        added_at: p.added_at,
        videos: mine.length,
        closed: closedCount(mine),
        linksDone: mine.reduce((sum, x) => sum + (x.links?.length ?? 0), 0),
        linksTotal: mine.length * ALL_PLATFORMS.length,
        burning: mine.filter((x) => x.overdue || x.status === 'partial').length,
        views: views.get(p.user_id) ?? 0,
        links: this.accountLinks(p),
        // Адрес публичной страницы специалиста. Хендл берём общим
        // хелпером: у кого выбран username — красивый адрес, у
        // остальных UUID, и оба открывает один и тот же маршрут.
        profile: ['/specialist', specialistHandle({ user_id: p.user_id })],
      };
    });
  });

  /**
   * Аккаунты креатора по площадкам — строками, а не чипами.
   *
   * Чипы здесь значили «профиль заполнен», а в плане выкладок точно такие
   * же чипы значат «ссылка на ролик сдана». Один и тот же элемент с двумя
   * смыслами на соседних экранах: в составе горела одна площадка из пяти,
   * а в плане рядом стояло зелёное «5/5 ссылок» — и понять, что из этого
   * правда, было нельзя. Текстом двусмысленности нет: видно и площадку, и
   * чей это аккаунт.
   */
  private accountLinks(
    p: ProjectPerson,
  ): { platform: Platform; label: string; short: string; url?: string; handle: string }[] {
    const links = p.account_links ?? {};
    return ALL_PLATFORMS.map((platform) => {
      const url = links[platform];
      return {
        platform,
        label: PLATFORM_LABEL[platform],
        // Короткая подпись для чипа: пять полных названий в строку не
        // помещаются и переносятся в две, а колонка от этого прыгает.
        short: PLATFORM_SHORT[platform],
        url,
        handle: url ? profileHandle(url) : '',
      };
    });
  }

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  public creatorName(name?: string): string {
    return creatorLabel(name);
  }

  public index(pub: Publication): string {
    const i = this.ordered().findIndex((p) => p.id === pub.id);
    return String(i + 1).padStart(2, '0');
  }

  /**
   * Номер выкладки по её id — для таблицы роликов.
   *
   * В колонке «Ролик» стояло слово «ссылка» пять раз подряд: строки
   * таблицы — это ссылки одного ролика по пяти площадкам, и отличить их
   * друг от друга было нечем. Номер выкладки тот же, что в плане, так что
   * строку отчёта можно найти в плане глазами.
   */
  /**
   * План сеткой: строки — креаторы, столбцы — дни периода.
   *
   * Список строками отвечает на «что сдать следующим», но не отвечает на
   * «как распределены выкладки по месяцу» — а именно это менеджер
   * держит в голове, когда двигает даты. В сетке дыра в расписании
   * видна сразу, и видно, у кого их три подряд.
   *
   * Диапазон берём по самим выкладкам, а не по календарному месяцу:
   * период проекта катится от первой публикации и на месяц не ложится.
   * Шире 45 дней не рисуем — столбцы становятся уже отметки.
   */
  public readonly gridDays = computed<string[]>(() => {
    const dates = this.ordered()
      .map((p) => p.due_date.slice(0, 10))
      .sort();
    if (!dates.length) return [];
    const from = new Date(dates[0] + 'T00:00:00Z');
    const to = new Date(dates[dates.length - 1] + 'T00:00:00Z');
    const out: string[] = [];
    for (let d = new Date(from); d <= to && out.length < 45; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  });

  public readonly gridRows = computed(() => {
    const days = this.gridDays();
    const byCreator = new Map<string, Map<string, Publication>>();
    for (const p of this.ordered()) {
      const day = p.due_date.slice(0, 10);
      const mine = byCreator.get(p.creator_user_id) ?? new Map<string, Publication>();
      // В один день у креатора выкладка одна: уникальность держит база.
      mine.set(day, p);
      byCreator.set(p.creator_user_id, mine);
    }
    return this.creators().map((c) => ({
      user_id: c.user_id,
      display_name: c.display_name,
      initial: c.initial,
      avatar: c.avatar,
      burning: c.burning,
      cells: days.map((day) => {
        const p = byCreator.get(c.user_id)?.get(day);
        if (!p) return { day, state: '' as const, title: '', mark: '' };
        const state = p.overdue
          ? ('late' as const)
          : p.status === 'done'
            ? ('done' as const)
            : p.status === 'partial'
              ? ('partial' as const)
              : ('planned' as const);
        const mark =
          state === 'done' ? '✓' : state === 'late' ? '!' : state === 'partial' ? '½' : '';
        const label = {
          done: 'вышел на всех площадках',
          late: 'просрочен',
          partial: 'вышел не везде',
          planned: 'в плане',
        }[state];
        return { day, state, title: `${c.display_name}, ${this.dayLabel(day)} — ${label}`, mark };
      }),
    }));
  });

  /** «14.09» — подпись дня в шапке сетки. */
  public dayLabel(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}.${m}`;
  }

  /** Выходной — столбцы субботы и воскресенья приглушаем. */
  public isWeekend(iso: string): boolean {
    const wd = new Date(iso + 'T00:00:00Z').getUTCDay();
    return wd === 0 || wd === 6;
  }

  /** Сегодняшний столбец обводим: без него в сетке не видно «сейчас». */
  public isToday(iso: string): boolean {
    return iso === new Date().toISOString().slice(0, 10);
  }

  public pubNo(publicationID: string): string {
    const i = this.ordered().findIndex((p) => p.id === publicationID);
    return i < 0 ? '—' : String(i + 1).padStart(2, '0');
  }

  public pubBadge(pub: Publication) {
    return publicationBadge(pub);
  }

  public pubDue(date: string): string {
    return dueLabel(date);
  }

  public pubMissing(pub: Publication) {
    return missingPlatforms(pub);
  }

  public pubOpen(pub: Publication): boolean {
    return canSubmitLinks(pub);
  }

  /**
   * Обратный отсчёт — только у того, что ещё ждут.
   *
   * У закрытой выкладки «−1 день» красным означал бы, что она просрочена,
   * хотя пять ссылок из пяти уже собраны: срок к ней больше не относится.
   * Дату оставляем — по ней выкладку и находят, — а отсчёт гасим.
   */
  public showCountdown(pub: Publication): boolean {
    return canSubmitLinks(pub);
  }

  // ---- план выкладок, сгруппированный по людям ----
  //
  // Менеджер ведёт план не списком дат, а по креаторам: «что у Анастасии»
  // — вопрос, который задают вслух. Плоский список из шестидесяти строк
  // на этот вопрос не отвечает, поэтому выкладки собраны в группы, а
  // строка группы сразу говорит, сколько закрыто и сколько горит.

  // ---- переключатели проекта ----

  /**
   * Этап согласования черновика.
   *
   * Включено — у выкладки два срока: сдать черновик и выложить, и бот
   * пингует по первому. Выключение не стирает уже проставленные сроки:
   * по ним креатор уже сдаёт, и отменять договорённость задним числом
   * нельзя — новые выкладки просто заводятся с одним сроком.
   */
  public readonly settings = signal<ProjectSettings | null>(null);

  public readonly settingsBusy = signal(false);

  public toggleDraftStage(): void {
    const cur = this.settings();
    if (!cur || this.settingsBusy()) return;
    const next: ProjectSettings = { ...cur, draft_required: !cur.draft_required };
    // Оптимистично: тумблер отзывается сразу, а на отказе возвращается —
    // иначе между нажатием и ответом он выглядит сломанным.
    this.settings.set(next);
    this.settingsBusy.set(true);
    this.pubApi.managerSaveProjectSettings(this.projectID(), next).subscribe({
      next: (saved) => {
        this.settings.set(saved);
        this.settingsBusy.set(false);
      },
      error: (e) => {
        this.settings.set(cur);
        this.settingsBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось сохранить настройку.').message);
      },
    });
  }

  /** Раскрытые строки: в свёрнутом виде площадок не видно. */
  public readonly openSlots = signal<ReadonlySet<string>>(new Set<string>());

  public toggleSlot(id: string): void {
    const next = new Set(this.openSlots());
    if (!next.delete(id)) next.add(id);
    this.openSlots.set(next);
  }

  public isSlotOpen(id: string): boolean {
    return this.openSlots().has(id);
  }

  /**
   * Колонка «черновик» — от настройки проекта, а не от данных строк.
   *
   * Этап согласования это свойство проекта: выключен — сдавать черновик
   * некому и бот по нему не пингует. Пока колонка держалась на «у кого-то
   * проставлена дата», выключенный этап оставлял на экране столбец с
   * прочерками — вопрос «а почему тут ничего» вместо информации. Даты у
   * старых строк при выключении не стираются намеренно, но столбца ради
   * них не держим. Настройки не доехали — решаем по данным, чтобы не
   * потерять колонку там, где этап включён.
   */
  /**
   * Выкладку завёл себе сам креатор, сверх плана.
   *
   * Менеджеру это видно там, где иначе стоял бы прочерк: у такой
   * выкладки нет срока черновика, и «не проставлен» здесь — не забывчивость.
   */
  public selfAdded(pub: Publication): boolean {
    return isSelfAdded(pub);
  }

  public readonly hasDrafts = computed(() => {
    const st = this.settings();
    if (st) return st.draft_required;
    return this.pubs().some((p) => !!p.draft_due_date);
  });

  public readonly slotGroups = computed(() => {
    const byUser = new Map<string, Publication[]>();
    for (const p of this.ordered()) {
      const rows = byUser.get(p.creator_user_id);
      if (rows) rows.push(p);
      else byUser.set(p.creator_user_id, [p]);
    }
    // Имя берём из состава: у креатора без единой выкладки его иначе нет,
    // а в плане он всё равно должен стоять — с пустой группой.
    const names = new Map(this.crew().map((c) => [c.user_id, c.display_name] as const));
    for (const id of names.keys()) if (!byUser.has(id)) byUser.set(id, []);

    return [...byUser.entries()].map(([userId, rows]) => {
      const name = creatorLabel(names.get(userId) ?? rows[0]?.creator_name);
      const live = rows.filter((p) => p.status !== 'cancelled');
      return {
        user_id: userId,
        display_name: name,
        initial: name.charAt(0).toUpperCase(),
        avatar: avatarClass(userId),
        rows,
        total: live.length,
        full: closedCount(live),
        bad: live.filter((p) => p.overdue || p.status === 'partial').length,
      };
    });
  });

  /** Цветная полоска слева от строки: горит, скоро, сдано. */
  public slotTone(pub: Publication): 'late' | 'soon' | 'done' | '' {
    if (pub.status === 'done' || pub.status === 'closed_manually') return 'done';
    if (pub.status === 'cancelled') return '';
    if (pub.overdue) return 'late';
    if (pub.status === 'partial') return 'soon';
    return daysLeft(pub.due_date) <= 2 ? 'soon' : '';
  }

  /** Тон даты в ячейке: красная просрочка, янтарное «вот-вот». */
  public dateTone(date: string, dim = false): 'late' | 'soon' | 'off' | '' {
    if (dim) return 'off';
    const d = daysLeft(date);
    if (d < 0) return 'late';
    return d <= 2 ? 'soon' : '';
  }

  /** Тон тега выкладки в словаре макета. */
  public tagTone(pub: Publication): 'green' | 'amber' | 'red' | '' {
    const tone = publicationBadge(pub).tone;
    if (tone === 'ok') return 'green';
    if (tone === 'warn') return 'amber';
    if (tone === 'late') return 'red';
    return '';
  }

  public linkOf(pub: Publication, platform: Platform): SubmittedLink | undefined {
    return linkFor(pub, platform);
  }

  public platState(pub: Publication, platform: Platform): 'on' | 'late' | 'off' {
    if (linkFor(pub, platform)) return 'on';
    return pub.overdue || pub.status === 'partial' ? 'late' : 'off';
  }

  /**
   * Каких площадок не хватает — подсказкой к лесенке площадок.
   *
   * Насечка говорит «пять из пяти» и молчит о том, какая из пяти пустая.
   * Раньше это говорили пять чипов с буквами, но они занимали вдвое
   * больше места и читались как кнопки. Имя недостающей площадки
   * остаётся в двух местах: здесь по наведению и в раскрытой строке,
   * где у каждой площадки своя строка со ссылкой.
   */
  public platsTitle(pub: Publication): string {
    const missing = this.platforms.filter((pl) => !linkFor(pub, pl));
    if (!missing.length) return 'Все площадки со ссылками';
    return `Нет ссылки: ${missing.map((pl) => PLATFORM_LABEL[pl]).join(', ')}`;
  }

  // Просмотры по каждой ссылке живут только в отчёте: в таблице ссылок их
  // нет, а второй раз считать их на фронте — заводить вторую правду.
  private readonly statsByLink = computed(() => {
    const m = new Map<string, VideoRow>();
    for (const row of this.report()?.videos_table ?? []) m.set(row.link_id, row);
    return m;
  });

  public linkStat(linkId: string): VideoRow | undefined {
    return this.statsByLink().get(linkId);
  }

  /** Прирост выкладки за сутки — сумма по её ссылкам. */
  public pubGrowth(pub: Publication): number {
    return (pub.links ?? []).reduce((sum, l) => sum + (this.linkStat(l.id)?.growth_24h ?? 0), 0);
  }

  /** Напомнить одному человеку по всем его открытым выкладкам. */
  public remindCreator(userId: string): void {
    const rows = this.ordered().filter((p) => p.creator_user_id === userId && canSubmitLinks(p));
    if (!rows.length) {
      this.msg.info('Открытых выкладок нет — напоминать не о чем.');
      return;
    }
    for (const p of rows) this.remind(p);
  }

  public readonly csvBusy = signal(false);

  // Выгрузка тянется запросом с токеном и сохраняется из памяти: ручка
  // закрыта Bearer, а в <a href> его не положить — прежняя ссылка молча
  // открывала вкладку с 401.
  public downloadCsv(): void {
    this.csvBusy.set(true);
    this.pubApi.managerReportCsv(this.projectID()).subscribe({
      next: (blob) => {
        this.csvBusy.set(false);
        downloadBlob(blob, `report-${this.projectID()}.csv`);
      },
      error: (e) => {
        this.csvBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось выгрузить отчёт.').message);
      },
    });
  }

  // Напомнить сейчас, не дожидаясь утренней рассылки. Второе нажатие
  // в тот же день бэк отклонит — показываем его текст, а не «ошибка».
  public remind(pub: Publication): void {
    this.pubBusy.set(pub.id);
    this.pubApi.managerRemind(pub.id).subscribe({
      next: (r) => {
        this.pubBusy.set(null);
        this.msg.success(r.sent ? 'Напоминание отправлено' : 'Напоминание не потребовалось');
      },
      error: (e) => {
        this.pubBusy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось отправить напоминание.').message);
      },
    });
  }

  public remindBurning(): void {
    for (const p of this.burning()) this.remind(p);
  }

  // ---- правка сданной ссылки ----
  //
  // Ссылку сдаёт креатор, и ошибается в ней он же. Раньше это чинилось
  // перепиской: менеджер видел, что цифры не собираются, и просил
  // прислать правильную. Теперь правит на месте — сервер при подмене
  // ролика удаляет его прежние замеры сам.

  public readonly linkEditFor = signal<VideoRow | null>(null);

  public linkEditUrl = '';

  public readonly linkBusy = signal(false);

  public openLinkEdit(row: VideoRow): void {
    this.linkEditFor.set(row);
    this.linkEditUrl = row.url;
  }

  public cancelLinkEdit(): void {
    this.linkEditFor.set(null);
    this.linkEditUrl = '';
  }

  public saveLinkEdit(): void {
    const row = this.linkEditFor();
    if (!row) return;
    const url = this.linkEditUrl.trim();
    if (!url) {
      this.msg.error('Пустое поле ничего не меняет. Снять ссылку — отдельная кнопка.');
      return;
    }
    this.applyLinkEdit(row, url, 'Ссылка исправлена');
  }

  public removeLink(): void {
    const row = this.linkEditFor();
    if (!row) return;
    this.applyLinkEdit(row, '', 'Ссылка снята — выкладка снова неполная');
  }

  private applyLinkEdit(row: VideoRow, url: string, okText: string): void {
    this.linkBusy.set(true);
    this.pubApi.managerEditLink(row.publication_id, row.platform, url).subscribe({
      next: () => {
        this.linkBusy.set(false);
        this.cancelLinkEdit();
        this.msg.success(okText);
        // Перечитываем план целиком: у выкладки сменился статус, а в
        // таблице ссылок — адрес и, возможно, цифры (loadPublications
        // тянет и отчёт).
        this.reloadPublications();
      },
      error: (e) => {
        this.linkBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось исправить ссылку.').message);
      },
    });
  }

  public readonly closeFor = signal<Publication | null>(null);

  public closeReason = '';

  public openClose(pub: Publication): void {
    this.closeFor.set(pub);
    this.closeReason = '';
  }

  public cancelClose(): void {
    this.closeFor.set(null);
  }

  // Закрыть неполную выкладку — исключение из правила «закрыто на пяти
  // ссылках», поэтому причина обязательна и на фронте тоже.
  public confirmClose(): void {
    const pub = this.closeFor();
    if (!pub) return;
    const reason = this.closeReason.trim();
    if (!reason) {
      this.msg.error('Напишите причину — без неё закрыть неполную выкладку нельзя.');
      return;
    }
    this.pubBusy.set(pub.id);
    this.pubApi.managerClose(pub.id, reason).subscribe({
      next: (saved) => {
        this.pubBusy.set(null);
        this.closeFor.set(null);
        this.pubs.set(this.pubs().map((p) => (p.id === saved.id ? saved : p)));
        this.msg.success('Выкладка закрыта');
      },
      error: (e) => {
        this.pubBusy.set(null);
        const err = parseApiError(e, 'Не удалось закрыть выкладку.');
        // 409 — её уже закрыли или отменили: перечитываем, кнопка уйдёт.
        if (err.code === 'publication_closed') {
          this.closeFor.set(null);
          this.reloadPublications();
        }
        this.msg.error(err.message);
      },
    });
  }

  public decideDate(pub: Publication, approve: boolean): void {
    const req = pub.pending_date_request;
    if (!req) return;
    this.pubBusy.set(pub.id);
    this.pubApi.managerDecideDateRequest(req.id, approve).subscribe({
      next: () => {
        this.pubBusy.set(null);
        this.msg.success(approve ? 'Дата перенесена' : 'Перенос отклонён');
        this.reloadPublications();
      },
      error: (e) => {
        this.pubBusy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось сохранить решение.').message);
      },
    });
  }

  public openSchedule(): void {
    const data: SchedulePublicationsData = {
      projectID: this.projectID(),
      creators: this.creators().map((c) => ({
        user_id: c.user_id,
        display_name: c.display_name,
      })),
      // Признака draft_required в DTO проекта нет — спрашиваем всегда:
      // бэк учтёт значение только если этап черновика включён.
      draftRequired: true,
      // Текущий план: окно открывается на нём, а не пустым. Пустое окно
      // читается как «плана нет», и даты набираются заново — поверх уже
      // стоящих.
      existing: this.pubs().map((p) => ({
        creator_user_id: p.creator_user_id,
        due_date: p.due_date,
        status: p.status,
      })),
    };
    this.modal
      .create({
        nzTitle: 'Проставить даты выкладок',
        nzContent: SchedulePublicationsDialogComponent,
        nzData: data,
        nzFooter: null,
        nzWidth: 560,
      })
      .afterClose.subscribe((res) => {
        if (res) this.reloadPublications();
      });
  }

  public openAddCreator(): void {
    const data: AddCreatorDialogData = { projectID: this.projectID() };
    this.modal
      .create({
        nzTitle: 'Добавить креатора в проект',
        nzContent: AddCreatorDialogComponent,
        nzData: data,
        nzFooter: null,
      })
      .afterClose.subscribe((res) => {
        if (res) this.reloadPublications();
      });
  }

  public removeCreator(userId: string): void {
    this.modal.confirm({
      nzTitle: 'Убрать креатора из проекта?',
      nzContent: 'Сданные выкладки и цифры в отчёте останутся — удаление мягкое.',
      nzOkDanger: true,
      nzOnOk: () =>
        this.pubApi.managerRemoveCreator(this.projectID(), userId).subscribe({
          next: () => {
            this.msg.success('Креатор убран из состава');
            this.reloadPublications();
          },
          error: (e) => this.msg.error(parseApiError(e, 'Не удалось убрать креатора.').message),
        }),
    });
  }

  private reloadPublications(): void {
    this.loadPublications(this.projectID());
  }

  private loadPublications(id: string): void {
    // У проекта не про выкладки этих ручек нет смысла спрашивать: раньше
    // сюда уходили три запроса на каждый проект по воронке, и все три
    // возвращали пустоту.
    if (!this.blocks().publications) {
      this.pubs.set([]);
      this.report.set(null);
      this.crew.set([]);
      this.order.set(null);
      return;
    }
    // Заказ, из которого вырос проект. Ходим сюда только у проектов с
    // креаторами: у остальных заказа не бывает по устройству.
    this.loadOrder(id);
    this.pubApi.managerList(id).subscribe({
      next: (r) => this.pubs.set(r.items),
      error: () => this.pubs.set([]),
    });
    this.pubApi.managerReport(id).subscribe({
      next: (r) => this.report.set(r),
      error: () => this.report.set(null),
    });
    this.pubApi.managerProjectSettings(id).subscribe({
      next: (r) => this.settings.set(r),
      error: () => this.settings.set(null),
    });
    this.pubApi.managerCreators(id).subscribe({
      next: (r) => this.crew.set(r.items),
      error: () => this.crew.set([]),
    });
  }
}
