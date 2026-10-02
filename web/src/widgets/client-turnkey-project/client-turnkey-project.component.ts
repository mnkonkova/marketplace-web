import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { downloadBlob } from '@shared/lib/download-blob';
import { specialistHandle } from '@shared/lib/specialist-link';
import { parseApiError } from '@shared/api/api-error';
import type { MonthRequest } from '@entities/publication/model/publication.types';
import { plural } from '@shared/lib/format';
import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney, groupDigits } from '@entities/billing/lib/money';
import { LADDER_STEP, shortViews } from '@entities/billing/lib/ladder';
import {
  isOpenPeriod,
  periodDay,
  periodRange,
  periodSettled,
  periodTitle,
  previousSeq,
  snapshotNote,
} from '@entities/billing/lib/period';
import type { Accrual, ProjectBilling } from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { currentMonth, monthToOpen } from '@entities/publication/lib/calendar-months';
import { projectBlocks } from '@entities/publication/lib/project-blocks';
import { videoCoverUrl } from '@entities/publication/lib/video-cover';
import {
  PLATFORM_COLOR,
  PLATFORM_LABEL,
  PLATFORM_SHORT,
  creatorLabel,
} from '@entities/publication/lib/publication-status';
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import type {
  CalendarDay,
  ClientVideo,
  NotificationPrefs,
  Platform,
  PublicationReport,
  VideoRow,
} from '@entities/publication/model/publication.types';
import { clientTitle } from '@entities/project/lib/project-title';
import type { ProjectClientView } from '@entities/project/model/project.types';
import type { CalendarPerson } from '@widgets/project-calendar/project-calendar.component';
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';
import { TelegramLinkComponent } from '@features/telegram-link/telegram-link.component';
import { LineChartComponent } from '@shared/ui/line-chart/line-chart.component';
import type { SeriesPoint } from '@shared/lib/chart-series';
import { MyDocumentsComponent } from '@widgets/my-documents/my-documents.component';
import { PrMarketAvaComponent } from '@shared/ui/prmarket-ava/prmarket-ava.component';
import {
  PrMarketTopComponent,
  PrMarketNavItem,
} from '@widgets/prmarket-top/prmarket-top.component';
import {
  PrMarketTabbarComponent,
  PrMarketTab,
} from '@widgets/prmarket-tabbar/prmarket-tabbar.component';
import type { OrderEstimate } from '@entities/order/model/order.types';
import { OrderApi } from '@entities/order/api/order.api';
import type { ProjectAccount } from '@entities/publication/model/publication.types';

/**
 * Раздел проекта заказчика. Их ТРИ, а не шесть.
 *
 * Шесть вкладок — «Ролики · Календарь · Статистика · Команда · Деньги ·
 * Переписка» — были шестью ящиками, а разговоров в них ровно два с
 * половиной. «Что сняли», «когда это выходило» и «кто снимал» — один
 * разговор про выкладки, и разложенный по трём вкладкам он заставлял
 * ходить туда-сюда, чтобы связать ролик с датой и человеком. Так же
 * «сколько набрали» и «сколько это стоит» — один разговор про деньги:
 * цифры без счёта ничего не стоят, счёт без цифр не объясним.
 *
 * Переписка осталась как была — это не отчёт, а разговор, и мешать её с
 * чем-то нельзя.
 *
 * У менеджера вкладок по-прежнему шесть, и это намеренно: он в проекте
 * работает — правит план, сверяет ссылки, считает деньги, — а заказчику
 * проект показывают. Разные задачи у одного и того же экрана — разное
 * членение.
 */
type ClientTab = 'summary' | 'videos' | 'calendar' | 'money' | 'access' | 'chat';

/** Белый список разделов: из адреса приезжает что угодно. */
const TABS: readonly ClientTab[] = ['summary', 'videos', 'calendar', 'money', 'access', 'chat'];

/**
 * Проект «креаторы под ключ» глазами заказчика.
 *
 * Отдельный компонент, а не ветка в странице проекта: это другой экран, а
 * не вариант того же. У проекта с воронкой — стадии, шаги и согласования;
 * здесь — ролики, площадки, цифры и деньги. Общего между ними ровно
 * заголовок, и держать оба вида в одном шаблоне значит каждый раз читать
 * половину чужой разметки.
 *
 * Разметка перенесена из макета ~/tmp/crm_project_client (1).html.
 */
@Component({
  selector: 'app-client-turnkey-project',
  standalone: true,
  imports: [
    MyDocumentsComponent,
    CommonModule,
    FormsModule,
    RouterLink,
    ProjectCommentsComponent,
    TelegramLinkComponent,
    LineChartComponent,
    PrMarketAvaComponent,
    PrMarketTopComponent,
    PrMarketTabbarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-turnkey-project.component.html',
  styleUrl: './client-turnkey-project.component.scss',
})
export class ClientTurnkeyProjectComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly pubApi = inject(PublicationApi);

  private readonly billingApi = inject(BillingApi);

  private readonly msg = inject(NzMessageService);

  /** Проект уже загружен страницей — второй раз его не тянем. */
  public readonly project = input.required<ProjectClientView>();

  public readonly meId = input<string>('');

  /**
   * Открытый раздел.
   *
   * Живёт в памяти виджета, а не в адресе, — ровно как во вкладках
   * проекта у менеджера. Ссылку на страницу проекта присылают друг другу
   * целиком («посмотри проект»), а не на её раздел, и раздел в адресе
   * означал бы, что ссылка, открытая соседом, показывает то, на чём
   * остановился отправитель.
   *
   * Первыми — выкладки: за ними на эту страницу и приходят. Деньги и
   * переписка стоят дальше, но главное про деньги — счёт за прошлый
   * период — вынесено над вкладками, и до него не надо никуда идти.
   */
  public readonly tab = signal<ClientTab>('summary');

  /**
   * Шесть разделов — ровно как в макете, и это не дробление ради
   * дробления. За каждым стоит свой вопрос: «как дела» (сводка), «что
   * сняли» (ролики), «когда выходило» (календарь), «сколько платить»
   * (деньги), «где наши аккаунты» (доступы) и «спросить человека»
   * (менеджер). Слитые в один длинный экран, они заставляли прокручивать
   * мимо пяти чужих ответов до своего.
   */
  public readonly tabs = computed<readonly { key: ClientTab; title: string }[]>(() => [
    { key: 'summary', title: 'Сводка' },
    { key: 'videos', title: 'Ролики' },
    { key: 'calendar', title: 'Календарь' },
    { key: 'money', title: 'Деньги' },
    { key: 'access', title: 'Документы и доступы' },
    // Вкладка подписана именем: к менеджеру идут как к человеку, и
    // «Ирина» видно раньше, чем прочитан заголовок внутри.
    { key: 'chat', title: this.managerName() || 'Менеджер' },
  ]);

  public setTab(t: ClientTab): void {
    this.tab.set(t);
  }

  /**
   * Разделы на телефоне: пять мест нижней полосы.
   *
   * «Документы и доступы» в полосу не влезли — это справочник, а не работа, и
   * на телефоне в него заходят раз в жизни. Проход к ним стоит строкой
   * в сводке (.only-phone), а не шестой вкладкой шириной в палец.
   */
  public readonly phoneTabs = computed<PrMarketTab[]>(() => [
    { key: 'summary', title: 'Сводка', icon: 'chart' },
    { key: 'videos', title: 'Ролики', icon: 'grid', badge: 0 },
    { key: 'calendar', title: 'Календарь', icon: 'cal' },
    { key: 'money', title: 'Деньги', icon: 'wallet', badge: this.prevDue() ? 1 : 0 },
    // Только имя: полное «Мария Менеджер» в клетку полосы не влезает, а
    // обрезанное многоточием читается хуже, чем просто имя.
    { key: 'chat', title: this.managerName().split(' ')[0] || 'Менеджер', icon: 'chat' },
  ]);

  // ---- шапка кабинета ----

  private readonly orderApi = inject(OrderApi);

  public readonly digits = groupDigits;

  public readonly short = shortViews;

  public decimal(v: number): string {
    return v.toFixed(1).replace('.', ',');
  }

  /** Вторая строка шапки: из чего состоит проект. */
  public readonly subtitleLine = computed(() => {
    const parts: string[] = [];
    const crew = this.billing()?.accruals?.length ?? 0;
    if (crew) parts.push(`${crew} ${plural(crew, 'креатор', 'креатора', 'креаторов')}`);
    parts.push(`${this.platformCount} площадок`);
    return parts.join(' · ');
  });

  public readonly nav = computed<PrMarketNavItem[]>(() => [
    { title: 'Все проекты', link: '/me/projects' },
    { title: this.title(), link: `/me/projects/${this.project().id}`, current: true },
  ]);

  /** «Период 2» — коротко, для шапки: даты стоят рядом, в деньгах. */
  public readonly periodLabelShort = computed(() => {
    const seq = this.billing()?.period?.seq;
    return seq ? `Период ${seq}` : '';
  });

  public readonly periodDayLine = computed(() => {
    const p = this.billing()?.period;
    return p ? periodRange(p) : '';
  });

  /**
   * Сколько периода пройдено. Границы считает сервер — здесь только
   * доля между ними: своего правила периода у браузера нет.
   */
  public readonly periodPercent = computed<number | null>(() => {
    const p = this.billing()?.period;
    if (!p) return null;
    const a = Date.parse(p.starts_on);
    const b = Date.parse(p.ends_on);
    if (!a || !b || b <= a) return null;
    const now = Date.now();
    if (now <= a) return 0;
    if (now >= b) return 100;
    return Math.round(((now - a) / (b - a)) * 100);
  });

  /**
   * Кто ведёт проект.
   *
   * Пусто, пока менеджер не назначен: заголовок тогда остаётся общим
   * («Ваш менеджер»), а не подписывается пустым именем.
   */
  public readonly managerName = computed(() => this.project().manager_display_name?.trim() ?? '');

  // ---- сводка ----

  /**
   * Цена ПРОСМОТРА: сервер считает тысячу, делим только для показа.
   *
   * Источников два, и это не запасной вариант, а два разных проекта.
   *
   * У проекта с креаторами счёт складывается из строк начисления, а
   * каждая строка — фикс за вышедшие ролики плюс хвост по просмотрам
   * сверх порога плюс KPI по подписчикам (бэк, calc.go). Цену тысячи
   * по ним считает денежная ручка.
   *
   * У проекта без креаторов ни фикса за ролик, ни ступеней в условиях
   * нет — складывать нечего, и в её итогах честный ноль; но проект
   * стоит денег, и сколько, назвал менеджер одним числом. По нему цену
   * тысячи считает отчёт (publications.fillCost) — тот же, из которого
   * взяты просмотры рядом, и то же число, что видит менеджер у себя.
   *
   * До этого заказчику такого проекта на месте цены просмотра стоял
   * прочерк: главный вопрос к проекту без креаторов оставался без
   * ответа именно у того, кто его задаёт.
   */
  public readonly cpm = computed(
    () => this.billing()?.totals?.cost_per_1000 || this.report()?.cost_per_1000 || 0,
  );

  public readonly cpv = computed(() => {
    const cpm = this.cpm();
    if (!cpm) return '';
    return `${(cpm / 100 / 1000).toFixed(2).replace('.', ',')} ₽`;
  });

  /**
   * Накопленный ряд: сервер отдаёт прирост за день, а на экране стоит
   * «всего на дату» — их складывает график, а не мы: ряд один и тот же,
   * просто показан итогом.
   */
  /**
   * Глубина графика. По умолчанию месяц: период проекта меряется
   * месяцем, и на нём видно, как ролик набирает после выхода.
   *
   * Переключатель едет ВМЕСТЕ С ГРАФИКОМ, а не стоит в шапке экрана: в
   * шапке он читался бы как фильтр всей страницы, а меняет он только
   * линию.
   */
  public readonly chartRange = signal<7 | 30>(30);

  public setChartRange(days: 7 | 30): void {
    this.chartRange.set(days);
  }

  /** Весь ряд накопительно. Из него режется окно. */
  private readonly cumulativeAll = computed<SeriesPoint[]>(() => {
    let sum = 0;
    return (this.report()?.by_day ?? []).map((d) => {
      sum += d.views;
      return { date: d.date, value: sum };
    });
  });

  public readonly cumulative = computed<SeriesPoint[]>(() =>
    this.cumulativeAll().slice(-this.chartRange()),
  );

  /**
   * Чисел меньше, чем на неделю: обе кнопки нарисуют одно и то же.
   *
   * Прятать переключатель нельзя — его тогда не найти вовсе; но и
   * промолчать нельзя: кнопка, от которой ничего не меняется, читается
   * как сломанная. Поэтому говорим прямо, за сколько дней есть числа.
   */
  public readonly chartDays = computed(() => this.cumulativeAll().length);

  /** Итоги площадок. Поденного разбора по площадкам сервер не отдаёт. */
  public readonly platformTotals = computed(() =>
    [...(this.report()?.by_platform ?? [])].sort((a, b) => b.views - a.views),
  );

  /** Доли отклика в полосе. Считает не сумму, а ширину — это оформление. */
  public readonly engage = computed(() => {
    const r = this.report();
    const likes = r?.likes ?? 0;
    const comments = r?.comments ?? 0;
    const shares = r?.shares ?? 0;
    const all = likes + comments + shares;
    if (!all) return { likesPct: 0, commentsPct: 0, sharesPct: 0 };
    return {
      likesPct: (likes / all) * 100,
      commentsPct: (comments / all) * 100,
      sharesPct: (shares / all) * 100,
    };
  });

  public readonly topVideos = computed(() =>
    [...this.videos()].sort((a, b) => b.views - a.views).slice(0, 3),
  );

  /** Подложка кадра: цвет площадки, которая тянет. Кадра может не быть. */
  public thumbBg(v: ClientVideo): string {
    const p = this.coverPlatform(v);
    return p ? this.tint(p) : 'var(--surface-2)';
  }

  /** Все пять площадок в фиксированном порядке: пустая — тоже ответ. */
  public allPlatforms(v: ClientVideo): { platform: Platform; url: string; views: number }[] {
    const rows = this.platformRows(v);
    const own = new Set(this.platformsOf(v));
    return ALL_PLATFORMS.map((platform) => {
      const row = rows.find((r) => r.platform === platform);
      return {
        platform,
        url: own.has(platform) ? (row?.url ?? '') : '',
        views: row?.views ?? 0,
      };
    });
  }

  /**
   * Вовлечённость ролика.
   *
   * Сервер её КЛИЕНТУ НЕ ОТДАЁТ: в ленте роликов есть просмотры, лайки и
   * комментарии, а er_percent приходит только менеджеру. Складывать её
   * здесь нельзя — без репостов она выйдет заниженной и разойдётся с той
   * же величиной в отчёте. Поэтому прочерк и пометка: число есть, но не
   * в этой ручке (см. список недостающих ручек в отчёте о работе).
   */
  public videoEr(v: ClientVideo): string {
    const rows = this.platformRows(v);
    const single = rows.length === 1 ? rows[0].er_percent : undefined;
    return single === undefined ? '—' : `${this.decimal(single)}%`;
  }

  // ---- календарь ----

  public readonly weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  public readonly pickedDay = signal('');

  public readonly monthTitle = computed(() => {
    const [y, m] = this.calendarMonth().split('-').map(Number);
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

  /** Сколько пустых клеток до первого числа: неделя начинается с Пн. */
  public readonly leadingBlanks = computed(() => {
    const [y, m] = this.calendarMonth().split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    return Array.from({ length: (first + 6) % 7 }, (_, i) => i);
  });

  public readonly monthGrid = computed(() => {
    const month = this.calendarMonth();
    const [y, m] = month.split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    const byDate = new Map(this.calendarDays().map((d) => [d.date.slice(0, 10), d]));
    const people = this.calendarPeople();
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;

    return Array.from({ length: total }, (_, i) => {
      const num = i + 1;
      const date = `${month}-${String(num).padStart(2, '0')}`;
      const day = byDate.get(date);
      const items = day?.items ?? [];
      const names = items.map((it) => ({
        name: creatorLabel(it.creator_name),
        avatar: people[it.creator_user_id]?.avatar_url,
      }));
      return {
        date,
        num,
        published: day?.published ?? 0,
        planned: day?.planned ?? 0,
        people: names,
        future: date > todayKey,
        today: date === todayKey,
        hint: names.length
          ? `${date > todayKey ? 'В плане' : 'Снимали'}: ${names.map((n) => n.name).join(', ')}`
          : 'Выкладок нет',
      };
    });
  });

  public pickDay(date: string): void {
    this.pickedDay.set(this.pickedDay() === date ? '' : date);
  }

  public readonly pickedDayTitle = computed(() => {
    const d = this.pickedDay();
    if (!d) return '';
    return periodDay(d, true);
  });

  /** Что вышло в выбранный день: ролики ленты, а не строки календаря. */
  public readonly dayVideos = computed(() => {
    const d = this.pickedDay();
    if (!d) return [];
    return this.videos().filter((v) => (v.published_at ?? '').slice(0, 10) === d);
  });

  public readonly dayPlanned = computed(() => {
    const d = this.pickedDay();
    if (!d) return [];
    const day = this.calendarDays().find((x) => x.date.slice(0, 10) === d);
    return (day?.items ?? []).filter((i) => i.status === 'planned');
  });

  public shiftMonth(delta: number): void {
    const [y, m] = this.calendarMonth().split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this.onMonthChange(next);
    this.pickedDay.set('');
  }

  // ---- доступы ----

  public readonly accounts = signal<ProjectAccount[]>([]);

  public readonly revealed = signal<Record<string, string>>({});

  public accountShort(platform: string): string {
    const map: Record<string, string> = {
      tiktok: 'TT',
      instagram: 'IG',
      youtube: 'YT',
      vk: 'VK',
      likee: 'LK',
      other: '···',
    };
    return map[platform] ?? '···';
  }

  /**
   * Пароль приходит отдельной ручкой, и по ней видно, кто его брал.
   * Поэтому «показать» — это запрос, а не разворачивание уже полученной
   * строки: пароля в списке проекта нет вовсе.
   */
  public toggleSecret(accountId: string): void {
    const cur = this.revealed();
    if (cur[accountId]) {
      const next = { ...cur };
      delete next[accountId];
      this.revealed.set(next);
      return;
    }
    this.pubApi.clientAccountSecret(this.project().id, accountId).subscribe({
      next: (r) => this.revealed.set({ ...this.revealed(), [accountId]: r.password }),
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось показать пароль.').message),
    });
  }

  // ---- смета на следующий месяц ----

  /**
   * Сколько креаторов в прикидке. Единица, а не ноль: ноль означал бы
   * «команды нет», и блок молчал до первого движения ползунка — то есть
   * ровно того вопроса, ради которого его и открывают, не отвечал.
   */
  public readonly smetaCount = signal(1);

  public readonly smetaEstimate = signal<OrderEstimate | null>(null);

  /**
   * Сколько роликов в месяц.
   *
   * Число это ВИДНО и его двигают: цена месяца складывается из роликов,
   * а не из числа людей, и прятать главное слагаемое за умолчанием
   * прайса значит показывать сумму, которую нельзя объяснить. Начальное
   * значение — из прайса: оно же подставится при оформлении заказа.
   */
  public readonly smetaVideos = signal(0);

  public onSmetaVideos(e: Event): void {
    const n = Number((e.target as HTMLInputElement).value);
    this.smetaVideos.set(n);
    this.recalcSmeta(this.smetaCount());
  }

  /**
   * Верхняя ступень лесенки — она же потолок за одного креатора.
   *
   * Лесенка устроена так, что выше последней ступени цена не растёт:
   * набрал креатор миллион просмотров или три, период стоит одинаково.
   * Поэтому отдельного «потолка» в условиях нет — им и работает верхняя
   * ступень.
   */
  public readonly topStepFee = computed(() => {
    const steps = this.smetaEstimate()?.terms?.steps ?? [];
    return steps.reduce((max, s) => Math.max(max, s.fee), 0);
  });

  /**
   * «Меньше N ₽» — вся цена месяца сверху.
   *
   * Складывается из двух известных заранее вещей: фикс за каждый ролик
   * плюс верхняя ступень за каждого креатора. Это ПОТОЛОК, а не
   * ожидание: столько выйдет, если у всех всё залетит. Считать среднее
   * по прошлым проектам здесь нельзя — заказчик читает его как обещание.
   */
  public readonly smetaCeiling = computed(() => {
    const e = this.smetaEstimate();
    if (!e) return 0;
    return e.salaries + this.smetaCount() * this.topStepFee();
  });

  public readonly smetaBusy = signal(false);

  public onSmeta(e: Event): void {
    const n = Number((e.target as HTMLInputElement).value);
    this.smetaCount.set(n);
    this.recalcSmeta(n);
  }

  private smetaTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Смету считает сервер, и только он. Ползунок двигают быстро, поэтому
   * запрос уходит после паузы: иначе на каждое деление летит свой, и
   * ответы приходят не в том порядке, в котором их спрашивали.
   */
  private recalcSmeta(n: number): void {
    if (this.smetaTimer) clearTimeout(this.smetaTimer);
    if (n < 1) {
      this.smetaEstimate.set(null);
      return;
    }
    this.smetaBusy.set(true);
    this.smetaTimer = setTimeout(() => {
      this.orderApi
        .draftEstimate({ needed: n, videos_count: this.smetaVideos(), creator_ids: [] })
        .subscribe({
          next: (e) => {
            this.smetaEstimate.set(e);
            this.smetaBusy.set(false);
          },
          error: () => {
            this.smetaEstimate.set(null);
            this.smetaBusy.set(false);
          },
        });
    }, 300);
  }

  // ---- заявка на следующий месяц ----

  /**
   * Открытая заявка проекта.
   *
   * Нужна экрану, чтобы вместо кнопки показать «заявка у менеджера»:
   * иначе человек жмёт её второй раз, не понимая, ушло ли первое, — а
   * ушло, и у менеджера уже горит плашка.
   */
  public readonly monthRequest = signal<MonthRequest | null>(null);

  public readonly askBusy = signal(false);

  public askMonth(): void {
    if (this.askBusy()) return;
    this.askBusy.set(true);
    this.pubApi
      .clientAskMonth(this.project().id, {
        creators: this.smetaCount(),
        videos: this.smetaVideos(),
        // Потолок — тот, что человек видел на экране. Пересчитывать его
        // на сервере незачем: разговор пойдёт именно об этой сумме, а
        // прайс к тому времени может смениться.
        ceiling: this.smetaCeiling(),
      })
      .subscribe({
        next: (r) => {
          this.monthRequest.set(r.request);
          this.askBusy.set(false);
          this.msg.success('Заявка у менеджера — он напишет по стоимости и составу.');
        },
        error: (e) => {
          this.askBusy.set(false);
          this.msg.error(parseApiError(e, 'Не удалось отправить заявку.').message);
        },
      });
  }

  private loadMonthRequest(): void {
    this.pubApi.clientMonthRequest(this.project().id).subscribe({
      next: (r) => this.monthRequest.set(r.request),
      error: () => this.monthRequest.set(null),
    });
  }

  /**
   * Условия площадки — ради объёма роликов в месяц. Тянем один раз и
   * молча: без них ползунок роликов встанет на ноль, и это честное
   * «объём не задан», а не сбой.
   */
  private loadOrderTerms(): void {
    this.orderApi.terms().subscribe({
      next: (r) => {
        this.smetaVideos.set(r.terms?.videos_next_months ?? 0);
        // Считаем сразу: человек открыл блок, чтобы увидеть число, а не
        // чтобы подвигать ползунок и тогда увидеть.
        this.recalcSmeta(this.smetaCount());
      },
      error: () => this.smetaVideos.set(0),
    });
  }

  /**
   * Уведомления в боте — раскрывающаяся полоса ПОД вкладками, а не
   * седьмая вкладка.
   *
   * Это настройка, а не раздел отчёта: галочки «что мне слать». В ряду с
   * «Выкладками» и «Деньгами» она обещала бы содержание того же рода, а
   * экран этот показывают начальству — личные галочки в одном клике от
   * отчёта однажды покажут вместе с ним. Отдельной страницы настроек
   * проекта у заказчика нет и заводить её ради трёх чекбоксов незачем,
   * поэтому они живут внизу страницы, свёрнутые: кому надо — найдёт,
   * остальным не мешает.
   */
  /**
   * Блок уведомлений раскрыт.
   *
   * По умолчанию свёрнут, но из воронки заказа сюда приходят именно за
   * ним — с ?prefs=1 после создания проекта: настройку предлагают сразу,
   * пока человек ещё здесь, а не «когда-нибудь найдёте внизу страницы».
   */
  public readonly prefsOpen = signal(
    // optional: виджет живёт и в тестах, и внутри страницы; без роутера
    // это просто «свёрнуто», а не падение компонента.
    inject(ActivatedRoute, { optional: true })?.snapshot.queryParamMap.get('prefs') === '1',
  );

  public togglePrefs(): void {
    this.prefsOpen.set(!this.prefsOpen());
  }

  /** Раскрытые ролики: разбор по площадкам открывается по требованию. */
  public readonly openVideos = signal<ReadonlySet<string>>(new Set<string>());

  // Счётчика состава здесь больше нет: он был числом на вкладке
  // «Команда», а вкладки такой не осталось — состав стоит блоком внутри
  // «Выкладок», и сколько там человек, видно по самим строкам.

  /**
   * Адрес страницы исполнителя.
   *
   * Через общий хелпер: у кого выбран username — красивый адрес, у
   * остальных uuid. Своя склейка здесь разошлась бы с остальными местами,
   * где на специалиста ссылаются, и половина ссылок вела бы по-старому.
   */
  public specialistLink(a: Accrual): string[] {
    return [
      '/specialist',
      specialistHandle({ username: a.creator_username, user_id: a.creator_user_id }),
    ];
  }

  /**
   * Есть ли куда вести ссылку на этого человека.
   *
   * Адрес страницы специалиста складывается всегда — из username или из
   * uuid, — а самой страницы по нему может не быть: публичная карточка
   * живёт только у опубликованного и прошедшего модерацию профиля, на всё
   * прочее ручка отдаёт 404. Ссылка стояла на всех одинаково, и на
   * непроверенном профиле состав периода вёл в «не найдено»: заказчик
   * платит за человека, жмёт на его имя и получает ответ, что такого
   * человека нет.
   *
   * Правило простое: либо ссылка ведёт туда, где что-то есть, либо её
   * нет вовсе. Разницу называем словами рядом с именем — иначе «почему по
   * одному кликается, а по другому нет» пришлось бы объяснять голосом.
   */
  public creatorLinkable(a: Accrual): boolean {
    return a.creator_profile_public === true;
  }

  /** Подпись ссылки для наведения: кружок сам по себе ничего не обещает. */
  public creatorTitle(a: Accrual): string {
    return `Открыть профиль: ${creatorLabel(a.creator_name)}`;
  }

  /**
   * Портреты для календаря, по creator_user_id.
   *
   * В дне календаря сервер отдаёт только имя и статус, а лица уже лежат
   * в составе периода — оттуда их и берём. Ссылку кладём по тому же
   * правилу, что и в составе: мёртвых ссылок на непубличные профили не
   * ставим.
   */
  public readonly calendarPeople = computed<Record<string, CalendarPerson>>(() => {
    const out: Record<string, CalendarPerson> = {};
    for (const a of this.billing()?.accruals ?? []) {
      out[a.creator_user_id] = {
        name: a.creator_name,
        avatar_url: a.creator_avatar_url,
        link: this.creatorLinkable(a) ? this.specialistLink(a) : undefined,
      };
    }
    return out;
  });

  public toggleVideo(id: string): void {
    const next = new Set(this.openVideos());
    if (!next.delete(id)) next.add(id);
    this.openVideos.set(next);
  }

  public isVideoOpen(id: string): boolean {
    return this.openVideos().has(id);
  }

  /**
   * Строки площадок ролика: ссылка, просмотры, прирост за сутки и ER.
   *
   * Берём из отчёта, который на этой странице уже загружен: в ленте
   * роликов есть только суммы по ролику, а разбор по площадкам —
   * единственное, ради чего заказчик её и раскрывает.
   */
  public platformRows(v: ClientVideo): VideoRow[] {
    const rows = this.report()?.videos_table ?? [];
    return rows.filter((r) => r.publication_id === v.publication_id);
  }

  /**
   * Ролик вышел не везде.
   *
   * Бейдж «N из 5 площадок» был зелёным всегда, и ролик, вышедший на двух
   * площадках, выглядел закрытым — это дезинформация, а не косметика:
   * именно по таким роликам менеджер и дожимает креатора.
   */
  public partial(v: ClientVideo): boolean {
    return this.platformsOf(v).length < ALL_PLATFORMS.length;
  }

  /** Имя креатора или внятная замена: uuid в ленте показывать нельзя. */
  public creatorName(name?: string): string {
    return creatorLabel(name);
  }

  /** Для какого проекта уже загружены лента, цифры и календарь. */
  private loadedFor = '';

  public constructor() {
    // Раздел, с которого открыли проект, — одноразово через адрес.
    //
    // Со списка проектов на телефоне ведут три кнопки: «Сводка»,
    // «Деньги» и «Открыть проект». Чтобы первые две попадали куда
    // обещают, раздел приезжает в `?tab=` — страница его читает и
    // СТИРАЕТ из адреса: дальше ссылка снова про проект целиком, как
    // и задумано выше. from_page при этом остаётся: merge.
    //
    // ?focus=documents — то же «откройся на нужном», но по смыслу, а не
    // по ключу вкладки: так зовёт бот о выданном документе, и где у этой
    // страницы документы, решает она.
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get('tab');
    const wanted = params.get('focus') === 'documents' ? 'access' : tab;
    if (wanted && TABS.includes(wanted as ClientTab)) {
      this.tab.set(wanted as ClientTab);
    }
    if (tab || params.has('focus')) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: null, focus: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    // Страница проекта опрашивает воронку раз в 30 секунд и каждый раз
    // кладёт в input НОВЫЙ объект. Без этой проверки эффект срабатывал на
    // каждый опрос: пять запросов в полминуты — и, что хуже, свежий ответ
    // clientPrefs затирал галочку уведомлений, которую пользователь
    // только что переключил и чей PUT ещё летел.
    effect(() => {
      const id = this.project().id;
      if (!id || id === this.loadedFor) return;
      this.loadedFor = id;
      this.load(id);
      this.loadOrderTerms();
      this.loadMonthRequest();
    });
  }

  // ---- выкладки: лента, цифры, календарь, уведомления ----
  //
  // Эти блоки есть только у проектов «креаторы под ключ». Раньше это
  // определялось по данным — пустая лента при пустом календаре считалась
  // проектом по воронке, — и новый проект без проставленных дат выглядел
  // так же. Теперь вид проекта приходит полем kind.

  /** Сколько площадок в проекте. В разметке «5» стояло числом. */
  public readonly platformCount = ALL_PLATFORMS.length;

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly platformColor = PLATFORM_COLOR;

  public readonly videos = signal<ClientVideo[]>([]);

  public readonly calendarDays = signal<CalendarDay[]>([]);

  public readonly calendarMonth = signal(currentMonth());

  /**
   * Месяцы, в которых у проекта вообще есть выкладки.
   *
   * Нужны сетке, чтобы отличить пустой месяц от потерянных данных, и
   * самой странице — чтобы открыть календарь там, где смотреть есть на
   * что.
   */
  public readonly calendarMonths = signal<string[]>([]);

  public readonly report = signal<PublicationReport | null>(null);

  // Показ статистики выключен настройкой проекта: бэк отвечает 404 и на
  // отчёт, и на цифры в ленте (там же приходит stats_hidden).
  public readonly statsDenied = signal(false);

  public readonly prefs = signal<NotificationPrefs | null>(null);

  public readonly blocks = computed(() => {
    const p = this.project();
    return projectBlocks('client', { kind: p.kind, statsAllowed: !this.statsDenied() });
  });

  public readonly csvBusy = signal(false);

  /**
   * У проекта ещё нет ни одного периода: не вышло ни одного ролика.
   *
   * Отдельно от «билинг не доехал». Ноль периодов — это состояние, и на
   * вкладке «Деньги» оно называется словами; сбой — другое дело и другой
   * текст. Одним пустым экраном их не различить, а действия у них
   * разные: в первом случае ждать выкладок, во втором звать менеджера.
   */
  public readonly noPeriods = signal(false);

  /**
   * Деньги проекта. В макете они разложены по трём местам сразу — плитка
   * «К оплате», карточки тарифа и состав месяца, — поэтому запрос делает
   * страница, а не отдельный виджет: иначе одни и те же данные грузились
   * бы трижды и расходились между блоками.
   */
  public readonly billing = signal<ProjectBilling | null>(null);

  /** Суммы приходят в копейках. */
  public readonly money = formatMoney;

  /**
   * Чем подписан столбец фикса.
   *
   * Фикс считается за ролик, и «Оклад» назвал бы здесь выключенную
   * механику. Старые снимки остались на окладе за период — у них
   * подпись прежняя: при одном креаторе «Оклады» ещё и ошибка
   * согласования, читатель ищет вторую строку, которой нет.
   */
  public readonly salaryTitle = computed(() => {
    if (this.billing()?.terms?.fee_per_video) return 'Фикс';
    return (this.billing()?.accruals ?? []).length === 1 ? 'Оклад' : 'Оклады';
  });

  /** Какой период показан: «Период 3 · 15 сентября — 14 октября». */
  public readonly periodTitle = computed(() => periodTitle(this.billing()?.period));

  /**
   * Заголовок без служебного суффикса.
   *
   * «(e2e)», «(тест)», «(копия)» — пометки конвейера, а не название
   * проекта. В экране, который показывают начальству и вставляют в
   * коммерческое предложение, они читаются как недоделка. Режем только
   * скобки в самом конце и только со служебным словом внутри: «Корм для
   * кошек (вертикальные ролики)» — часть названия, и трогать её нельзя.
   */
  public readonly title = computed(() => clientTitle(this.project().title));

  /**
   * Период в шапке — НАСТОЯЩИЙ и датами: «Период 1 · 15 сентября —
   * 14 октября 2026».
   *
   * Раньше здесь стояло «Период 1: 15.09 — 14.10»: без года и без
   * состояния. По такой подписи не понять ни какого года период, ни
   * закрыт он или ещё растёт, — а от этого зависит, окончательная сумма
   * рядом или предварительная. Ещё раньше на этом месте вовсе стояла
   * дата ЗАВЕДЕНИЯ проекта, и шапка объявляла период, которого нет.
   *
   * Пусто, пока периода нет: выдуманная дата хуже отсутствующей — по ней
   * начинают считать сроки.
   */
  public readonly periodLine = computed(() => periodTitle(this.billing()?.period));

  /** Состояние периода словом: открытый и подытоженный — разные счета. */
  public readonly periodState = computed(() => (this.preliminary() ? 'идёт' : 'подытожен'));

  /**
   * Цена тысячи крупно: число одним кеглем, единица — мелкой пометкой.
   * Режем готовую строку formatMoney по неразрывному пробелу, чтобы
   * правило «дробную часть только когда она есть» осталось в одном месте.
   */
  private readonly costParts = computed(() =>
    this.money(this.billing()?.totals?.cost_per_1000).split('\u00a0'),
  );

  public readonly costHead = computed(() => this.costParts()[0] ?? '');

  public readonly costUnit = computed(() => this.costParts()[1] ?? '');

  /**
   * Тарифная лесенка счёта. Приходит с сервера посчитанной и только
   * тогда, когда сходится с итогом и просмотрами рядом: в браузере тариф
   * не считаем никогда.
   */
  public readonly tariff = computed(() => this.billing()?.tariff ?? null);

  /** Шаг шкалы насечек — общий для заказчика, креатора и менеджера. */
  public readonly ladderStep = LADDER_STEP;

  /**
   * Оговорки к счёту за прошлый период — под катом.
   *
   * Их две, обе длинные, и обе про «как так вышло», а не про «сколько и
   * куда платить». Развёрнутыми они давали плашке четыре абзаца, в
   * которых сумма — то единственное, ради чего плашка есть, — читалась
   * наравне с объяснением, почему просмотры подтянуты. Свёрнуто по
   * умолчанию; сам признак приблизительности виден снаружи, у суммы.
   */
  public readonly dueNoteOpen = signal(false);

  public toggleDueNote(): void {
    this.dueNoteOpen.set(!this.dueNoteOpen());
  }

  /**
   * ER строкой. Звёздочки нет: оговорка про репосты раскрыта словами в
   * той же строке, а сноска отправляла искать расшифровку, которой рядом
   * не было.
   */
  public readonly erText = computed(() => {
    const p = this.report()?.er_percent;
    return p == null ? '' : `${p.toFixed(1).replace('.', ',')}%`;
  });

  /**
   * Есть ли что показывать числами.
   *
   * Отчёт приходит и у проекта, где не вышло ни одного ролика: сервер
   * честно отдаёт нули. Но ноль просмотров и «ничего не выходило» —
   * разные утверждения: первое значит «посмотрели ноль раз», второе —
   * «смотреть было нечего». Ряд нулей в первом экране читается как
   * провал работы, а не как её отсутствие, поэтому чисел там, где мерить
   * было нечего, нет вовсе — вместо них одна строка словами.
   */
  public readonly hasNumbers = computed(() => (this.report()?.videos ?? 0) > 0);

  /**
   * Проект только что заведён заявкой: команды нет, дат нет, снимать
   * ещё некому.
   *
   * Отличать это состояние от «работа идёт, первый ролик ещё не вышел»
   * обязательно. Тексты у них разные не по вежливости, а по смыслу:
   * тому, кто вчера нажал «Отправить», надо сказать, что заявку
   * получили и ответят; тому, у кого команда собрана и даты стоят, —
   * что цифры появятся после первой выкладки. Общая фраза «цифр пока
   * нет» первому звучит как тишина, в которой он и так просидел
   * несколько дней.
   */
  public readonly justApplied = computed(
    () =>
      this.videos().length === 0 &&
      this.calendarDays().every((d) => !d.items?.length) &&
      (this.billing()?.accruals?.length ?? 0) === 0,
  );

  /** Период ещё идёт — счёт не окончательный. */
  public readonly preliminary = computed(() => isOpenPeriod(this.billing()?.period));

  /** Числа подтянуты, а не измерены: поденной статистики уже нет. */
  public readonly approximate = computed(() => !!this.billing()?.period?.snapshot_approx);

  /**
   * Счёт за прошлый период.
   *
   * Отдельным запросом и отдельной плашкой: наверху страницы стоит
   * текущий период, а он ещё идёт — платить по нему нечего. Платят по
   * подытоженному, и его сумма не должна теряться в ленте роликов.
   */
  public readonly prevBilling = signal<ProjectBilling | null>(null);

  /**
   * Счёт за прошлый период, пока по нему не рассчитались.
   *
   * Два условия, и оба обязательны.
   *
   * Период должен быть ПОДЫТОЖЕН: пока он открыт, сумма ещё меняется, и
   * выставлять её к оплате рано.
   *
   * И по нему не должно быть отметки об оплате. Раньше её здесь не
   * спрашивали вовсе, и плашка жила ровно один период: начинался
   * следующий — прошлый становился позапрошлым, и «к оплате» исчезало
   * само, оплатили его или нет. То есть напоминание о долге снимал
   * календарь, а не деньги. Теперь снимает менеджер, когда отметит
   * «Деньги пришли», — и ровно об этом плашка и говорит.
   *
   * Правило «что считать расчётом» живёт в periodSettled рядом с
   * периодами: оно про платежи, а не про этот экран, и второй его копии
   * быть не должно.
   */
  public readonly prevDue = computed(() => {
    const b = this.prevBilling();
    if (b?.period?.status !== 'locked') return null;
    // Платежи проектные, а не периодные, и приходят в обоих ответах
    // одинаковые: берём из свежего, чтобы не зависеть от порядка
    // загрузки двух запросов.
    const payments = this.billing()?.payments ?? b.payments;
    return periodSettled(b.period, payments) ? null : b;
  });

  public readonly prevTitle = computed(() => periodTitle(this.prevDue()?.period));

  /** «по состоянию на 14 октября» — когда снят срез прошлого периода. */
  public readonly prevSnapshot = computed(() => snapshotNote(this.prevDue()?.period));

  public readonly prevApprox = computed(() => !!this.prevDue()?.period?.snapshot_approx);

  /**
   * Команда собрана автоматически по приоритету, а не выбрана вручную.
   * Приоритет есть только у проектов, выросших из заказа, — подпись
   * «собрана по вашему приоритету» без него была бы неправдой.
   */
  public readonly fromOrder = computed(() =>
    (this.billing()?.accruals ?? []).some((a) => (a.priority ?? 0) > 0),
  );

  // Выгрузка тянется запросом с токеном и сохраняется из памяти: прежняя
  // ссылка в <a href> Bearer не несёт и открывала вкладку с 401.
  public downloadCsv(): void {
    const p = this.project();
    this.csvBusy.set(true);
    this.pubApi.clientReportCsv(p.id).subscribe({
      next: (blob) => {
        this.csvBusy.set(false);
        downloadBlob(blob, `report-${p.id}.csv`);
      },
      error: (e) => {
        this.csvBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось выгрузить отчёт.').message);
      },
    });
  }

  public onMonthChange(month: string): void {
    this.calendarMonth.set(month);
    const p = this.project();
    if (p) this.loadCalendar(p.id, month);
  }

  public platformsOf(v: ClientVideo): Platform[] {
    return v.platforms ?? [];
  }

  /**
   * Чей знак стоит на месте обложки.
   *
   * Та площадка, что ТЯНЕТ, а не первая в списке: список приходит в
   * порядке базы, и на кадре оказывался Instagram у ролика, две трети
   * просмотров которого пришли из TikTok. Кадр — единственная картинка
   * карточки, и врать ей нельзя.
   *
   * Пусто, если площадок нет вовсе: тогда и места обложки нет. Пустой
   * прямоугольник читался бы как несработавшая загрузка.
   */
  public coverPlatform(v: ClientVideo): Platform | null {
    return this.openLinks(v)[0]?.platform ?? this.platformsOf(v)[0] ?? null;
  }

  /** Цвет площадки, разбавленный до подложки кадра. */
  public tint(platform: Platform): string {
    return `${PLATFORM_COLOR[platform] ?? '#888'}1f`;
  }

  /**
   * Обложки, которые не загрузились. Адрес превью YouTube выводится из
   * ссылки, а не приходит с сервера, и у снятого ролика его может не
   * быть: тогда возвращаемся к знаку площадки, а не показываем битый
   * значок картинки.
   */
  private readonly coverFailed = signal<ReadonlySet<string>>(new Set());

  /** Кадр ролика, если его вообще можно вывести из ссылок. */
  public coverUrl(v: ClientVideo): string | null {
    if (this.coverFailed().has(v.publication_id)) return null;
    return videoCoverUrl(v.links);
  }

  /** Портрет и ссылка автора ролика — из состава периода. */
  public videoPerson(v: ClientVideo): CalendarPerson | null {
    return this.calendarPeople()[v.creator_user_id] ?? null;
  }

  public creatorInitial(name?: string): string {
    return (name || '—').trim().charAt(0).toUpperCase();
  }

  public onCoverError(v: ClientVideo): void {
    const next = new Set(this.coverFailed());
    next.add(v.publication_id);
    this.coverFailed.set(next);
  }

  /**
   * Площадки ролика со ссылками на сам ролик.
   *
   * Ради этого заказчик сюда и приходит: не «мы отчитались о просмотрах»,
   * а «вот ролик, откройте и сверьте». Ссылка лежала под раскрытием «По
   * площадкам» вместе с разбором чисел, то есть в двух кликах от главного
   * доказательства.
   *
   * Ссылки может не быть: площадка отмечена, а URL ещё не сдан. Тогда
   * значок остаётся значком — мёртвая ссылка хуже её отсутствия.
   */
  public linksOf(v: ClientVideo): { platform: Platform; url: string }[] {
    const rows = this.platformRows(v);
    return this.platformsOf(v).map((platform) => ({
      platform,
      url: rows.find((r) => r.platform === platform)?.url ?? '',
    }));
  }

  /**
   * То же, но с числом: сколько просмотров у ролика на этой площадке.
   *
   * Число внутри кнопки, а не под раскрытием «По площадкам». Раскрытие
   * было ещё одним кликом до главного доказательства и показывало ровно
   * то же самое: площадку, ссылку и просмотры. Теперь всё это и есть
   * кнопка, а лишнего состояния «раскрыто/свёрнуто» у карточки больше
   * нет.
   *
   * Порядок — по убыванию просмотров: первой та, что тянет. Площадки без
   * чисел (статистика выключена менеджером) держат свой порядок и
   * остаются кнопками без числа — ссылка от этого не перестаёт работать.
   */
  public openLinks(v: ClientVideo): { platform: Platform; url: string; views: number }[] {
    const rows = this.platformRows(v);
    return this.platformsOf(v)
      .map((platform) => {
        const row = rows.find((r) => r.platform === platform);
        return { platform, url: row?.url ?? '', views: row?.views ?? 0 };
      })
      .sort((a, b) => b.views - a.views);
  }

  public togglePref(field: 'on_new_video' | 'on_weekly_digest' | 'on_date_shift'): void {
    const p = this.project();
    const current = this.prefs();
    if (!p || !current) return;
    const next = !current[field];
    // Оптимистично: переключатель отзывается сразу, а на ошибке
    // возвращается обратно — иначе он «залипает» на время запроса.
    this.prefs.set({ ...current, [field]: next });
    this.pubApi.clientSavePrefs(p.id, { [field]: next }).subscribe({
      next: (saved) => this.prefs.set(saved),
      error: (e) => {
        this.prefs.set(current);
        this.msg.error(parseApiError(e, 'Не удалось сохранить настройку.').message);
      },
    });
  }

  // Прошлый период тянем только если он есть: у первого периода
  // предыдущего не бывает, и спрашивать нулевой номер незачем.
  private loadPrevious(id: string, current: ProjectBilling): void {
    const seq = previousSeq(current.period);
    if (seq === null) {
      this.prevBilling.set(null);
      return;
    }
    this.billingApi.clientBilling(id, seq).subscribe({
      next: (b) => this.prevBilling.set(b),
      error: () => this.prevBilling.set(null),
    });
  }

  /**
   * @param autoPick разрешено ли перепрыгнуть на месяц, где выкладки есть.
   *
   * Разрешено ровно при первой загрузке проекта. Дальше месяц выбирает
   * человек стрелками, и подменять его выбор нельзя: пустой месяц,
   * открытый намеренно, — это ответ «здесь ничего не стоит», а не повод
   * увезти его в другой.
   */
  private loadCalendar(id: string, month: string, autoPick = false): void {
    this.pubApi.clientCalendar(id, month).subscribe({
      next: (r) => {
        this.calendarDays.set(r.days);
        this.calendarMonths.set(r.months ?? []);
        if (!autoPick) return;
        const better = monthToOpen(r.months ?? [], month);
        if (better === month) return;
        // Выкладки этого проекта лежат в другом месяце — открываем его.
        // Второй запрос здесь неизбежен: какой месяц показывать, видно
        // только из ответа, а спрашивать «где что есть» отдельной
        // ручкой значило бы два запроса ВСЕГДА, а не в этом случае.
        this.calendarMonth.set(better);
        this.loadCalendar(id, better);
      },
      error: () => {
        this.calendarDays.set([]);
        this.calendarMonths.set([]);
      },
    });
  }

  private load(id: string): void {
    this.billingApi.clientBilling(id).subscribe({
      next: (b) => {
        this.noPeriods.set(false);
        this.billing.set(b);
        this.loadPrevious(id, b);
      },
      // 404 no_periods — у проекта не вышло ни одного ролика, и отсчёт
      // периодов начинается с первого. Это состояние, а не сбой, и
      // молчать о нём нельзя: пустая вкладка «Деньги» читается как «не
      // загрузилось», а не как «платить пока не за что». Тарифа у
      // проекта может не быть вовсе — это другая причина и другой текст.
      error: (e) => {
        this.noPeriods.set(parseApiError(e, '').code === 'no_periods');
        this.billing.set(null);
        this.prevBilling.set(null);
      },
    });
    this.pubApi.clientVideos(id).subscribe({
      next: (r) => this.videos.set(r.items),
      error: () => this.videos.set([]),
    });
    this.pubApi.clientReport(id).subscribe({
      next: (r) => {
        this.report.set(r);
        this.statsDenied.set(false);
      },
      // 404 здесь означает и «не ваш проект», и «показ статистики
      // выключен» — бэк отвечает одинаково намеренно, чтобы перебором
      // нельзя было узнать, какие проекты существуют.
      error: () => this.statsDenied.set(true),
    });
    this.pubApi.clientPrefs(id).subscribe({
      next: (p) => this.prefs.set(p),
      error: () => this.prefs.set(null),
    });
    // Доступы к аккаунтам бренда. Пароля здесь нет — он приходит
    // отдельной ручкой, по которой видно, кто его брал.
    this.pubApi.clientAccounts(id).subscribe({
      next: (r) => this.accounts.set(r.items),
      error: () => this.accounts.set([]),
    });
    // untracked: месяц читаем как значение, а не как зависимость. Иначе
    // листание календаря перезапускало бы весь эффект — пять запросов
    // вместо одного, и календарь дважды.
    this.loadCalendar(
      id,
      untracked(() => this.calendarMonth()),
      true,
    );
  }
}
