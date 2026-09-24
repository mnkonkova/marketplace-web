import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { catchError, forkJoin, of } from 'rxjs';

import { ClientProfile, ClientProfileApi } from '@entities/me/api/client-profile.api';
import { OrderApi } from '@entities/order/api/order.api';
import type { Order } from '@entities/order/model/order.types';
import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectClientView } from '@entities/project/model/project.types';
import { clientTitle } from '@entities/project/lib/project-title';
import { PLATFORM_SHORT } from '@entities/publication/lib/publication-status';
import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney, groupDigits } from '@entities/billing/lib/money';
import { periodDay, periodRange } from '@entities/billing/lib/period';
import { RANGE_LABEL, RANGE_PREV, RANGE_TABS } from '@entities/billing/lib/overview';
import type {
  ClientOverview,
  OverviewProject,
  OverviewRange,
  Payment,
  ProjectBilling,
} from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  ALL_PLATFORMS,
  type CalendarDay,
  type Platform,
  type PublicationReport,
} from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { plural } from '@shared/lib/format';
import type { SeriesPoint } from '@shared/lib/chart-series';
import { LineChartComponent } from '@shared/ui/line-chart/line-chart.component';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { SotkaTopComponent } from '@widgets/sotka-top/sotka-top.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';
import { withFromPage } from '@shared/nav/from-page';

/** Строка реестра: проект с креаторами или проект по воронке. */
interface ProjectRow {
  id: string;
  title: string;
  /** Состояние словом и цветом плашки. */
  state: string;
  tone: 'ok' | 'warn' | 'neu' | 'crit' | 'acc';
  /** Вторая строка: период и состав. */
  meta: string;
  /** Доля пройденного периода, 0..100. null — периода нет. */
  progress: number | null;
  /** Поденный ряд для спарклайна. Пусто — рисовать нечего. */
  series: readonly SeriesPoint[];
  viewsLabel: string;
  cpv: string;
  er: string;
  spent: string;
  /** Ближайшая выкладка: «18.09 · Лев Орлов». Пусто — не знаем. */
  next: string;
  turnkey: boolean;
}

/** Неоплаченный счёт по любому проекту — то, что просят сделать сегодня. */
interface DueRow {
  projectId: string;
  project: string;
  kind: string;
  tone: 'warn' | 'crit' | 'ok';
  amount: number;
  note: string;
  paid: boolean;
}

/** День ближайших выкладок по всем проектам. */
interface UpcomingDay {
  date: string;
  day: string;
  weekday: string;
  first: boolean;
  items: { name: string; project: string }[];
}


const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

/**
 * Кабинет заказчика, экран «Все проекты» — перенос из макета
 * ~/tmp/sotka-cabinets.html (раздел «ЗАКАЗЧИК · ВСЕ ПРОЕКТЫ»).
 *
 * Порядок блоков в макете — это порядок вопросов, с которыми экран
 * открывают: во сколько обходится просмотр → что происходит в проектах
 * → сколько просят денег → где дешевле → что вышло лучше всего → что
 * выходит на следующей неделе. Менять его местами нельзя: первым стоит
 * то, ради чего кабинет открывают, а не то, что проще посчитать.
 *
 * Ни одно число здесь не складывается в браузере. Сводка приходит
 * готовой (`/me/overview`), поденные ряды и вовлечённость — из отчёта
 * проекта, счета — из его денег. Там, где сервер не отдаёт чего-то
 * вовсе, на экране стоит честный прочерк, а не посчитанная нами замена:
 * два разных числа на двух экранах хуже одного отсутствующего.
 */
@Component({
  selector: 'app-projects-list-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    AppHeaderComponent,
    LineChartComponent,
    SotkaTopComponent,
    SupportFooterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-list.page.html',
  styleUrl: './projects-list.page.scss',
})
export class ProjectsListPage {
  private readonly api = inject(ProjectApi);

  private readonly billing = inject(BillingApi);

  private readonly pubApi = inject(PublicationApi);

  private readonly profileApi = inject(ClientProfileApi);

  private readonly orderApi = inject(OrderApi);



  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly destroyRef = inject(DestroyRef);

  private readonly msg = inject(NzMessageService);

  public readonly money = formatMoney;

  public readonly digits = groupDigits;

  public readonly plural = plural;

  public readonly ranges = RANGE_TABS;

  public readonly rangeLabel = RANGE_LABEL;

  public readonly rangeTabs = RANGE_TABS;

  public readonly loading = signal(true);

  public readonly overview = signal<ClientOverview | null>(null);

  public readonly projects = signal<ProjectClientView[]>([]);

  /** Имя заказчика — дашборд подписывает им свой ответ. */
  public readonly clientName = computed(() => this.contacts()?.display_name ?? '');

  public readonly contacts = signal<ClientProfile>({
    user_id: '',
    display_name: '',
    phone: '',
    telegram: '',
  });

  public readonly activeOrders = signal<Order[]>([]);

  // ---- контакты ----
  //
  // Форма отдельной структурой, а не правкой сигнала: пока человек
  // печатает, «сохранённое» состояние не должно меняться — иначе
  // подпись «Сохранено» держалась бы над уже изменённым полем.
  public contactForm = { display_name: '', telegram: '', phone: '' };

  public readonly contactsBusy = signal(false);

  public readonly contactsSaved = signal(false);

  /** Отчёты проектов: поденный ряд, вовлечённость, число роликов. */
  private readonly reports = signal<Record<string, PublicationReport>>({});

  /** Деньги проектов: из них собираются счета «к оплате». */
  private readonly moneyByProject = signal<Record<string, ProjectBilling>>({});

  /** Календари идущих проектов: из них — ближайшие выкладки. */
  private readonly calendars = signal<Record<string, CalendarDay[]>>({});

  /**
   * Окно сводки. Живёт в адресе: этот экран показывают начальству и
   * дают на него ссылку, а ссылка на «квартал» обязана открыться
   * кварталом.
   */
  public readonly range = signal<OverviewRange>('month');

  public readonly prevLabel = computed(() => RANGE_PREV[this.range()]);

  // ---- сводка сверху ----

  /**
   * Цена ПРОСМОТРА, а не тысячи: так она стоит в макете и так её
   * называет заказчик. Сервер считает тысячу — делим ровно здесь, в
   * одном месте, и только для показа.
   */
  public readonly cpv = computed(() => this.perView(this.overview()?.cost_per_1000));

  /**
   * Цена просмотра БЕЗ знака рубля.
   *
   * В макете единица набрана мельче самого числа — «0,22» крупно и
   * « ₽» вполовину. Поэтому шаблону нужно число отдельно, а не готовая
   * строка: разрезать её в разметке значило бы разбирать обратно то,
   * что только что склеили.
   */
  public readonly cpvValue = computed(() => {
    const v = this.cpv();
    return v ? v.replace(' ₽', '') : '';
  });

  public readonly er = computed(() => {
    const v = this.overview()?.window?.er_percent;
    return v === undefined || v === null ? '' : this.decimal(v, 1);
  });

  public readonly erDelta = computed(() => this.overview()?.window?.er_delta_pp ?? null);

  /** Величина изменения без знака: знак несёт стрелка рядом. */
  public absDecimal(v: number): string {
    return this.decimal(Math.abs(v), 1);
  }

  public readonly viewsTotal = computed(() => this.overview()?.views.total ?? 0);

  public readonly runningCount = computed(
    () => this.overview()?.projects.filter((p) => p.state === 'running').length ?? 0,
  );

  public readonly videosTotal = computed(() =>
    Object.values(this.reports()).reduce((s, r) => s + r.videos, 0),
  );

  public readonly spent = computed(() => this.overview()?.money.total ?? 0);

  public readonly paid = computed(() => this.overview()?.money.paid ?? 0);

  public readonly asOf = computed(() => {
    const o = this.overview();
    return o?.collected_at || o?.generated_at || '';
  });

  // ---- реестр проектов ----

  public readonly rows = computed<ProjectRow[]>(() => {
    const out: ProjectRow[] = [];
    const reports = this.reports();
    const cal = this.calendars();

    for (const p of this.overview()?.projects ?? []) {
      const r = reports[p.project_id];
      const state = this.projectState(p);
      out.push({
        id: p.project_id,
        title: clientTitle(p.title),
        state: state.label,
        tone: state.tone,
        meta: this.projectMeta(p, r),
        progress: p.period ? this.periodPercent(p.period.starts_on, p.period.ends_on) : null,
        series: (r?.by_day ?? []).map((d) => ({ date: d.date, value: d.views })),
        viewsLabel: p.views ? this.digits(p.views) : '',
        cpv: this.perView(p.cost_per_1000) || '—',
        er: r?.er_percent === undefined ? '—' : `${this.decimal(r.er_percent, 1)}%`,
        spent: p.total ? this.money(p.total) : '—',
        next: this.nextPublication(cal[p.project_id] ?? []),
        turnkey: true,
      });
    }

    // Проекты по воронке: роликов и цены просмотра у них нет вовсе, и
    // числа в этих колонках у них не прочерк «не посчитали», а «нечего
    // считать». Поэтому они идут теми же строками, но с подписью про
    // этап, а не про просмотры.
    for (const p of this.projects()) {
      if (p.kind === 'creators_turnkey') continue;
      out.push({
        id: p.id,
        title: clientTitle(p.title),
        state: p.display_status === 'completed' ? 'завершён' : 'по этапам',
        tone: p.display_status === 'waiting_action' ? 'warn' : 'neu',
        meta: p.current_step_title ? `сейчас: ${p.current_step_title}` : 'проект по этапам',
        progress: p.progress ?? null,
        series: [],
        viewsLabel: '',
        cpv: '—',
        er: '—',
        spent: p.budget ? `${this.digits(p.budget)} ₽` : '—',
        next: '',
        turnkey: false,
      });
    }
    return out;
  });

  /** Где дешевле просмотр: те же проекты, отсортированные по цене. */
  public readonly cpvBars = computed(() => {
    const items = (this.overview()?.projects ?? []).filter((p) => p.cost_per_1000);
    const max = Math.max(...items.map((p) => p.cost_per_1000 ?? 0), 1);
    return [...items]
      .sort((a, b) => (a.cost_per_1000 ?? 0) - (b.cost_per_1000 ?? 0))
      .map((p, i) => ({
        title: clientTitle(p.title),
        paused: p.state !== 'running',
        width: Math.round(((p.cost_per_1000 ?? 0) / max) * 100),
        value: this.perView(p.cost_per_1000),
        best: i === 0,
      }));
  });

  // ---- деньги ----

  public readonly due = computed<DueRow[]>(() => {
    const byId = new Map(
      (this.overview()?.projects ?? []).map((p) => [p.project_id, clientTitle(p.title)]),
    );
    const out: DueRow[] = [];
    for (const [id, b] of Object.entries(this.moneyByProject())) {
      for (const pay of b.payments ?? []) {
        if (pay.status === 'cancelled') continue;
        out.push({
          projectId: id,
          project: byId.get(id) ?? '',
          kind: pay.kind === 'prepayment' ? 'предоплата' : 'счёт',
          tone: pay.status === 'confirmed' ? 'ok' : pay.kind === 'prepayment' ? 'crit' : 'warn',
          amount: pay.amount,
          note: this.paymentNote(pay),
          paid: pay.status === 'confirmed',
        });
      }
    }
    // Неоплаченное сверху: это то, что просят сделать, а оплаченное —
    // то, что уже сделали, и оно здесь только чтобы сумма сходилась.
    return out.sort((a, b) => Number(a.paid) - Number(b.paid) || b.amount - a.amount);
  });

  public readonly dueTotal = computed(() =>
    this.due()
      .filter((d) => !d.paid)
      .reduce((s, d) => s + d.amount, 0),
  );

  // ---- топ-3 ролика ----

  public readonly topVideos = computed(() => (this.overview()?.top_videos ?? []).slice(0, 3));

  public readonly platShort = PLATFORM_SHORT;

  /**
   * Строка топа как в макете: кто снял, в каком проекте, на каких
   * площадках вышел ролик и с какой вовлечённостью.
   *
   * Проект и площадки берём из отчётов проектов, а не из сводки: у
   * залетевшего ролика сводка называет только ту площадку, на которой
   * он выстрелил, — а вышел он на всех пяти, и открыть человек может
   * захотеть любую.
   *
   * Отчёты грузятся не по всем проектам, а по первым шести (см.
   * loadDetails: это N+1, и расширять его ради трёх строк топа нельзя).
   * Ролик седьмого проекта остаётся с одной площадкой и без плашки
   * проекта — это меньше, чем хотелось бы, но не выдумка: столько про
   * него и знает сводка. Починится вместе с ручкой, которая отдаст
   * площадки прямо в top_videos.
   */
  public readonly topRows = computed(() => {
    const titles = new Map(
      (this.overview()?.projects ?? []).map((p) => [p.project_id, clientTitle(p.title)]),
    );
    const project = new Map<string, string>();
    const links = new Map<string, { platform: Platform; url: string }[]>();
    for (const r of Object.values(this.reports())) {
      for (const v of r.videos_table) {
        project.set(v.publication_id, titles.get(r.project_id) ?? '');
        const list = links.get(v.publication_id) ?? [];
        if (!list.some((l) => l.platform === v.platform)) {
          list.push({ platform: v.platform, url: v.url });
        }
        links.set(v.publication_id, list);
      }
    }
    return this.topVideos().map((v, i) => ({
      rank: i + 1,
      id: v.publication_id,
      title: v.title || 'Без названия',
      creator: v.creator_display_name ?? '',
      project: project.get(v.publication_id) ?? '',
      // Площадки в одном и том же порядке во всех строках: список
      // читают столбцом, и переставленные наклейки заставляют искать
      // нужную заново в каждой строке.
      links: (links.get(v.publication_id) ?? [{ platform: v.platform as Platform, url: v.url }])
        .slice()
        .sort((a, b) => ALL_PLATFORMS.indexOf(a.platform) - ALL_PLATFORMS.indexOf(b.platform)),
      views: v.views,
      er: v.er_percent === undefined ? '' : this.decimal(v.er_percent, 1),
      erStar: !!v.er_without_shares,
    }));
  });

  // ---- ближайшие выкладки ----

  public readonly upcoming = computed<UpcomingDay[]>(() => {
    const titles = new Map(
      (this.overview()?.projects ?? []).map((p) => [p.project_id, clientTitle(p.title)]),
    );
    const today = this.todayKey();
    const byDate = new Map<string, UpcomingDay>();

    for (const [id, days] of Object.entries(this.calendars())) {
      for (const d of days) {
        const key = d.date.slice(0, 10);
        if (key < today) continue;
        const planned = d.items.filter((i) => i.status === 'planned');
        if (!planned.length) continue;
        const row = byDate.get(key) ?? {
          date: key,
          day: key.slice(8, 10),
          weekday: this.weekday(key),
          first: false,
          items: [],
        };
        for (const i of planned) {
          row.items.push({ name: i.creator_name || 'без имени', project: titles.get(id) ?? '' });
        }
        byDate.set(key, row);
      }
    }

    const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
    if (out.length) out[0].first = true;
    return out;
  });

  public readonly upcomingCount = computed(() =>
    this.upcoming().reduce((s, d) => s + d.items.length, 0),
  );

  public readonly upcomingSpan = computed(() => {
    const u = this.upcoming();
    if (!u.length) return '';
    const from = u[0];
    const to = u[u.length - 1];
    return from.date === to.date
      ? `${from.day} ${this.monthOf(from.date)}`
      : `${from.day}–${to.day} ${this.monthOf(to.date)}`;
  });

  // ---- каталог креаторов и смета ----









  /**
   * Дальше — воронка заказа: там месяц старта, лимит и условия, с
   * которыми надо согласиться. Отправить заявку прямо отсюда нельзя не
   * из-за экрана, а из-за того, что заказ без согласия с условиями не
   * создаётся.
   */

  // ---- переходы ----

  /**
   * Открыть проект, при желании — сразу на нужном разделе.
   *
   * Раздел уезжает в адрес одноразово: страница проекта его прочитает и
   * сотрёт. Ссылку на проект присылают целиком («посмотри проект»), и
   * раздел, застрявший в адресе, показывал бы соседу то, на чём
   * остановился отправитель.
   */
  public open(row: ProjectRow, tab?: 'summary' | 'money'): void {
    const extras = withFromPage(this.router);
    void this.router.navigate(['/me/projects', row.id], {
      ...extras,
      queryParams: { ...(extras.queryParams ?? {}), ...(tab ? { tab } : {}) },
    });
  }

  public setRange(r: OverviewRange): void {
    if (r === this.range()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { range: r === 'month' ? null : r },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public openOrder(id: string): void {
    void this.router.navigate(['/me/orders', id], withFromPage(this.router));
  }

  public orderStatusLabel(o: Order): string {
    if (o.status === 'staffed') return 'состав собран';
    if (o.status === 'draft') return 'приглашения не ушли';
    return `ждём ответы, ${o.accepted} из ${o.needed}`;
  }

  // ---- разбор чисел ----

  /** Копейки за тысячу → рубли за просмотр, с запятой: «0,21 ₽». */
  private perView(costPer1000: number | null | undefined): string {
    if (!costPer1000) return '';
    const rub = costPer1000 / 100 / 1000;
    return `${rub.toFixed(2).replace('.', ',')} ₽`;
  }

  private decimal(v: number, digits: number): string {
    return v.toFixed(digits).replace('.', ',');
  }

  private projectState(p: OverviewProject): { label: string; tone: ProjectRow['tone'] } {
    if (p.state === 'running') return { label: 'идёт', tone: 'ok' };
    if (p.state === 'completed') return { label: 'завершён', tone: 'neu' };
    return { label: 'не начался', tone: 'warn' };
  }

  private projectMeta(p: OverviewProject, r?: PublicationReport): string {
    const parts: string[] = [];
    if (p.period) parts.push(periodRange(p.period));
    else if (p.state === 'not_started') parts.push('ждёт первой выкладки');
    if (p.completed_at) parts.push(`закончен ${periodDay(p.completed_at)}`);
    if (r?.videos) parts.push(`${r.videos} ${plural(r.videos, 'ролик', 'ролика', 'роликов')}`);
    return parts.join(' · ');
  }

  /**
   * Сколько периода пройдено. Считается по границам, которые прислал
   * сервер: своего правила периода у браузера нет и быть не должно.
   */
  private periodPercent(from: string, to: string): number | null {
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (!a || !b || b <= a) return null;
    const now = Date.now();
    if (now <= a) return 0;
    if (now >= b) return 100;
    return Math.round(((now - a) / (b - a)) * 100);
  }

  private nextPublication(days: CalendarDay[]): string {
    const today = this.todayKey();
    for (const d of [...days].sort((x, y) => x.date.localeCompare(y.date))) {
      const key = d.date.slice(0, 10);
      if (key < today) continue;
      const planned = d.items.filter((i) => i.status === 'planned');
      if (!planned.length) continue;
      const who = planned[0].creator_name || 'без имени';
      const more = planned.length > 1 ? ` +${planned.length - 1}` : '';
      return `${key.slice(8, 10)}.${key.slice(5, 7)} · ${who}${more}`;
    }
    return '';
  }

  private paymentNote(p: Payment): string {
    if (p.status === 'confirmed') {
      return p.confirmed_at ? `оплачен ${periodDay(p.confirmed_at)}` : 'оплачен';
    }
    return p.note || (p.kind === 'prepayment' ? 'без неё команда не выйдет' : 'счёт выставлен');
  }

  private todayKey(): string {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private weekday(key: string): string {
    const d = new Date(`${key}T00:00:00`);
    return WEEKDAYS[d.getDay()] ?? '';
  }

  private monthOf(key: string): string {
    return MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? '';
  }

  // ---- загрузка ----

  public constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const raw = q.get('range');
      const r: OverviewRange =
        raw === 'week' || raw === 'quarter' || raw === 'month' ? raw : 'month';
      if (r !== this.range() || !this.overview()) {
        this.range.set(r);
        this.loadOverview();
      }
    });

    this.api.listClientProjects().subscribe({
      next: (resp) => this.projects.set(resp.items),
      error: () => this.projects.set([]),
    });

    this.profileApi.get().subscribe({
      next: (cp) => {
        this.contacts.set(cp);
        this.contactForm = {
          display_name: cp.display_name ?? '',
          telegram: cp.telegram ?? '',
          phone: cp.phone ?? '',
        };
      },
    });

    this.orderApi.listOrders().subscribe({
      next: (r) =>
        this.activeOrders.set(
          r.items.filter((o) => o.status !== 'cancelled' && o.status !== 'paid'),
        ),
      error: () => this.activeOrders.set([]),
    });

  }

  /** Сохранить контакты. Шлём все три поля: сервер принимает частичное
   *  тело, но форма и так показывает их вместе. */
  public saveContacts(): void {
    if (this.contactsBusy()) return;
    this.contactsBusy.set(true);
    this.contactsSaved.set(false);
    this.profileApi
      .patch({
        display_name: this.contactForm.display_name.trim(),
        telegram: this.contactForm.telegram.trim(),
        phone: this.contactForm.phone.trim(),
      })
      .subscribe({
        next: (cp) => {
          this.contacts.set(cp);
          this.contactsBusy.set(false);
          this.contactsSaved.set(true);
        },
        error: (e) => {
          this.contactsBusy.set(false);
          this.msg.error(parseApiError(e, 'Не удалось сохранить контакты.').message);
        },
      });
  }

  private loadOverview(): void {
    this.loading.set(true);
    this.billing.clientOverview(this.range()).subscribe({
      next: (o) => {
        this.overview.set(o);
        this.loading.set(false);
        this.loadDetails(o);
      },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Добор по проектам: поденный ряд, счета и план выкладок.
   *
   * Сводка их не отдаёт — она про итоги, — а на экране они стоят у
   * каждой строки. Поэтому за ними идём в проектные ручки, и только за
   * теми проектами, которые ещё идут: у законченного плана выкладок
   * нет, а его итоги уже пришли сводкой.
   *
   * Это N+1 и мы про него знаем: правильное место для этих чисел —
   * сама сводка (см. docs — там же список недостающих ручек). Пока их
   * там нет, второй запрос честнее, чем пустая колонка.
   */
  private loadDetails(o: ClientOverview): void {
    const running = o.projects.filter((p) => p.state !== 'not_started').slice(0, 6);
    if (!running.length) return;

    forkJoin(
      running.map((p) =>
        forkJoin({
          id: of(p.project_id),
          report: this.pubApi.clientReport(p.project_id).pipe(catchError(() => of(null))),
          billing: this.billing.clientBilling(p.project_id).pipe(catchError(() => of(null))),
          calendar:
            p.state === 'running'
              ? this.pubApi.clientCalendar(p.project_id).pipe(catchError(() => of(null)))
              : of(null),
        }),
      ),
    ).subscribe((list) => {
      const reports: Record<string, PublicationReport> = {};
      const money: Record<string, ProjectBilling> = {};
      const cal: Record<string, CalendarDay[]> = {};
      for (const r of list) {
        if (r.report) reports[r.id] = r.report;
        if (r.billing) money[r.id] = r.billing;
        if (r.calendar) cal[r.id] = r.calendar.days;
      }
      this.reports.set(reports);
      this.moneyByProject.set(money);
      this.calendars.set(cal);
    });
  }
}
