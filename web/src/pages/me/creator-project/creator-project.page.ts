import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  ALL_PLATFORMS,
  ChecklistItem,
  CreatorProjectCard,
  LinkSuggestion,
  ProjectAccount,
  Platform,
  Publication,
  PublicationReport,
} from '@entities/publication/model/publication.types';
import {
  PLATFORM_LABEL,
  PLATFORM_SHORT,
  canSubmitLinks,
  closedCount,
  daysLeft,
  dueLabel,
  isClosed,
  linkFor,
  linksCollected,
  missingPlatforms,
  publicationBadge,
} from '@entities/publication/lib/publication-status';
import {
  commonItems,
  itemsForPlatform,
  requiredUnchecked,
} from '@entities/publication/lib/checklist';
import {
  isDisabledDay,
  isSelfAdded,
  takenOn,
  ymdLocal,
} from '@entities/publication/lib/extra-publication';
import { formatMoney, groupDigits } from '@entities/billing/lib/money';
import { periodTitle } from '@entities/billing/lib/period';
import { projectBlocks } from '@entities/publication/lib/project-blocks';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { CreatorAvailabilityComponent } from '@widgets/creator-availability/creator-availability.component';
import { TelegramLinkComponent } from '@features/telegram-link/telegram-link.component';
import { BillingApi } from '@entities/billing/api/billing.api';
import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import { nextStepKind } from '@entities/billing/lib/creator-highlights';
import { MeRepository } from '@entities/me/repository/me.repository';
import type { MeProfile } from '@entities/me/model/me.types';
import type { Material } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { plural } from '@shared/lib/format';
import { ProjectAccountsComponent } from '@widgets/project-accounts/project-accounts.component';
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { SotkaTopComponent, SotkaNavItem } from '@widgets/sotka-top/sotka-top.component';
import { SotkaTabbarComponent, SotkaTab } from '@widgets/sotka-tabbar/sotka-tabbar.component';
import { LADDER_STEP, LadderVideo, ladderState, shortViews } from '@entities/billing/lib/ladder';
import { videosInPeriod } from '@entities/billing/lib/creator-highlights';

// Сколько находок помещается на экран, не отнимая его у выкладок.
//
// Сервис обходит аккаунты креаторов каждый день и кладёт всё новое, так
// что десяток карточек — обычное утро понедельника. Стоят они ПЕРЕД
// календарём выкладок, ради которого страницу и открывают: три вопроса
// человек прочитает, стену из десяти пролистает мимо — вместе с
// календарём. Три и меньше не сворачиваем вовсе: прятать то, что и так
// видно целиком, значит просить лишнее нажатие ни за что.
const SUGGEST_FOLD_AT = 3;

// Страница проекта глазами креатора: карточка проекта, его выкладки,
// чеклист, материалы, заработок и цифры по его же роликам. Шапка берётся
// из GET /me/creator/projects/{id} — там есть и бриф, и период, и месячный
// план, и кому писать; собирать её из списка выкладок больше не нужно.
@Component({
  selector: 'app-creator-project-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzDatePickerModule,
    NzIconModule,
    NzInputModule,
    NzModalModule,
    NzSpinModule,
    NzTagModule,
    CreatorAvailabilityComponent,
    TelegramLinkComponent,
    ProjectAccountsComponent,
    ProjectCommentsComponent,
    AppHeaderComponent,
    SotkaTopComponent,
    SotkaTabbarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-project.page.html',
  styleUrl: './creator-project.page.scss',
})
export class CreatorProjectPage {
  private readonly api = inject(PublicationApi);

  private readonly billing = inject(BillingApi);

  /**
   * Профиль специалиста — ради ссылок на аккаунты площадок.
   *
   * Своего состава проекта креатору API не отдаёт (там account_links
   * есть только у менеджера), а площадки без аккаунта — это его деньги:
   * один ролик идёт на все площадки проекта, и та, на которой человека
   * нет, просмотров не приносит.
   */
  private readonly me = inject(MeRepository);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  // Свой id — чтобы в переписке свои сообщения были подписаны «Вы».
  public readonly meId = inject(AuthSessionStore).userId;

  public readonly platformLabel = PLATFORM_LABEL;

  // ---- «это ваш ролик?» ----
  //
  // Сервис видит ролик на аккаунте раньше, чем креатор успевает вставить
  // ссылку. Привязать его молча нельзя: ошибка сопоставления припишет
  // человеку чужую работу. Поэтому — вопрос и два ответа.

  /** Находки по ЭТОМУ проекту: сервер отдаёт их по всем сразу. */
  public readonly suggestions = signal<LinkSuggestion[]>([]);

  /** id находки, по которой сейчас идёт запрос. */
  public readonly suggestBusy = signal<string | null>(null);

  /** Раскрыт ли свёрнутый список находок. Закрыт, пока не попросили. */
  public readonly suggestExpanded = signal(false);

  /**
   * Нужна ли свёртка. Считается от длины списка, а не запоминается при
   * загрузке: креатор отвечает на находки прямо здесь, и как только их
   * осталось три, строка-итог обязана уйти сама — иначе человек сидит
   * перед кнопкой «показать» ради трёх карточек.
   */
  public readonly suggestFolded = computed(() => this.suggestions().length > SUGGEST_FOLD_AT);

  /** Видны ли сами карточки: без свёртки — всегда. */
  public readonly suggestListVisible = computed(
    () => !this.suggestFolded() || this.suggestExpanded(),
  );

  /**
   * Что написано на свёртке. Число в тексте, а не «есть находки»:
   * решение «открывать сейчас или после выкладок» человек принимает
   * именно по количеству.
   */
  public readonly suggestSummary = computed(() => {
    const n = this.suggestions().length;
    return `Нашли ${n} ${plural(n, 'ролик', 'ролика', 'роликов')}`;
  });

  public toggleSuggest(): void {
    this.suggestExpanded.update((v) => !v);
  }

  private loadSuggestions(projectId: string): void {
    this.api.creatorSuggestions().subscribe({
      next: (r) => this.suggestions.set((r.items ?? []).filter((s) => s.project_id === projectId)),
      // Молча: страница выкладок из-за подсказки падать не должна.
      error: () => this.suggestions.set([]),
    });
  }

  public linkSuggestion(s: LinkSuggestion): void {
    this.suggestBusy.set(s.id);
    this.api.creatorLinkSuggestion(s.id, s.suggested_publication_id).subscribe({
      next: () => {
        this.suggestBusy.set(null);
        this.dropSuggestion(s.id);
        this.msg.success('Привязали — проверьте ссылки на других площадках.');
        this.fetch(this.projectId(), true);
      },
      error: (e) => {
        this.suggestBusy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось привязать ролик.').message);
      },
    });
  }

  public dismissSuggestion(s: LinkSuggestion): void {
    this.suggestBusy.set(s.id);
    this.api.creatorDismissSuggestion(s.id).subscribe({
      next: () => {
        this.suggestBusy.set(null);
        this.dropSuggestion(s.id);
      },
      error: (e) => {
        this.suggestBusy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось отклонить находку.').message);
      },
    });
  }

  private dropSuggestion(id: string): void {
    this.suggestions.set(this.suggestions().filter((x) => x.id !== id));
  }

  public readonly platformShort = PLATFORM_SHORT;

  /**
   * Суммы приходят в копейках: на экран — рублями.
   *
   * Форматирование вернулось вместе с плашкой итога за прошлый период.
   * Его убрали, когда со страницы ушёл блок «Условия проекта», — тогда
   * звать его было больше некому.
   */
  public readonly money = formatMoney;

  public readonly loading = signal(true);

  public readonly projectId = signal('');

  public readonly card = signal<CreatorProjectCard | null>(null);

  /**
   * Проекта нет или мы не в его составе.
   *
   * Раньше 404 по карточке просто гасился, и человек видел обычную
   * страницу с нулями: «выкладок пока нет — менеджер ещё не проставил
   * даты». По чужому проекту это неправда, а по несуществующему —
   * вдвойне.
   */
  public readonly notFound = signal(false);

  public readonly items = signal<Publication[]>([]);

  public readonly checklist = signal<ChecklistItem[]>([]);

  public readonly report = signal<PublicationReport | null>(null);

  /**
   * Заработок за периоды — одним ответом на страницу.
   *
   * Берёт его страница, а не каждый виджет сам: тем же ответом живут и
   * шкала ступеней, и достижения, и история, и разорванные по
   * компонентам запросы ушли бы за ним трижды.
   *
   * Поле `terms` (оклад, ставка за тысячу, ставка сверх порога) в этом
   * ответе по-прежнему приходит, но у креатора больше не показывается:
   * карточку «Условия проекта» убрали по решению владельца продукта.
   * Своей арифметики по ставкам здесь не было и нет — числа приходили с
   * сервера готовыми.
   */
  public readonly earnings = signal<CreatorEarnings | null>(null);

  /**
   * Итог за прошлый период — плашкой, пока деньги не выплачены.
   *
   * Подытог ставит воркер через две недели после конца периода: до этого
   * числа ещё едут, после — заморожены и пересчёту не подлежат. Момент
   * подытога и есть ответ на «сколько я заработал» — и он должен быть
   * виден сразу, а не строкой в истории под всеми блоками.
   *
   * Держится не по календарю: период сменится, а деньги останутся
   * неполученными. Уходит, когда начисление переходит в «выплачено» —
   * тогда оно переезжает в «период за периодом», где лежит всё
   * закрытое.
   *
   * Берём ПОСЛЕДНИЙ подытоженный: если их накопилось несколько
   * невыплаченных, человеку важнее свежий, а остальные видны в истории.
   */
  public readonly lastClosed = computed(() => {
    const e = this.earnings();
    if (!e) return null;
    const locked = (e.periods ?? []).filter((p) => p.status === 'locked');
    for (let i = locked.length - 1; i >= 0; i -= 1) {
      const p = locked[i];
      const row = (e.accruals ?? []).find(
        (a) => a.period_start.slice(0, 10) === p.starts_on.slice(0, 10),
      );
      if (row && row.status !== 'paid') return { period: p, row };
    }
    return null;
  });

  /** «Период 1 · 15 сентября — 14 октября» для плашки итога. */
  public readonly closedTitle = computed(() => periodTitle(this.lastClosed()?.period ?? null));

  /** Срез приблизительный: поденной статистики за период уже нет. */
  public readonly closedApprox = computed(() => !!this.lastClosed()?.period?.snapshot_approx);

  /**
   * Что с деньгами сейчас. Три состояния, и они про разное: посчитали,
   * утвердили, отправили. Молчать о них нельзя — «подытожено» человек
   * читает как «деньги придут сегодня».
   */
  public readonly closedState = computed(() => {
    const st = this.lastClosed()?.row.status;
    if (st === 'approved') return 'Утверждено — деньги в очереди на выплату';
    return 'Подытожено — ждёт утверждения менеджером';
  });

  /** Текущий период — его границы и состояние. */
  public readonly period = computed(() => this.earnings()?.period ?? null);

  /** Конец текущего периода: «до 12 окт.» в подписи плана. */
  public readonly periodEnds = computed(() => this.period()?.ends_on ?? null);

  // Прошлые периоды страница больше не перечисляет сама: их показывает
  // app-creator-history. Сопоставление «начисление → границы периода»
  // жило здесь второй копией и разъезжалось бы с ним по мелочам.

  /** Материалы проекта: бренд-гайд, обучение, ссылки на аккаунты. */
  public readonly materials = signal<Material[]>([]);

  /** Свой профиль специалиста. null — не загрузился, блок не показываем. */
  public readonly profile = signal<MeProfile | null>(null);

  /**
   * Площадки проекта, для которых в профиле не указан аккаунт.
   *
   * Пока профиль не пришёл — пусто: «заполните три площадки» на
   * незагруженных данных было бы упрёком ни за что.
   *
   * Likee в этот счёт не входит: поля под неё в редакторе профиля нет
   * вовсе (см. PROFILE_PLATFORMS), и звать заполнить то, что нечем
   * заполнить, — худший вид совета.
   */
  /**
   * Аккаунты проекта — по ним и считаем, чего не хватает.
   *
   * Раньше считалось по личному профилю специалиста, и человек с полным
   * профилем видел «всё привязано», сдавая ролики с других аккаунтов.
   * Пусто, пока список не приехал: «не привязано ничего» до загрузки —
   * это обвинение на пустом месте.
   */
  public readonly projectAccounts = signal<ProjectAccount[]>([]);

  public readonly missingAccounts = computed(() => {
    if (!this.accountsLoaded()) return [];
    const have = new Set(this.projectAccounts().map((a) => a.platform));
    return this.projectPlatforms().filter((p) => !have.has(p));
  });

  private readonly accountsLoaded = signal(false);

  /** «YouTube, ВКонтакте» — перечисление площадок одной строкой. */
  public readonly missingAccountsList = computed(() =>
    this.missingAccounts()
      .map((p) => PLATFORM_LABEL[p])
      .join(', '),
  );

  // Отчёт закрытого проекта: 410 collapsed_no_detail. Не ошибка, а
  // состояние — показываем текстом вместо цифр.
  public readonly reportCollapsed = signal(false);

  public readonly busy = signal(false);

  public constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.projectId.set(id);
      this.fetch(id);
    } else {
      this.loading.set(false);
    }
  }

  // ═══ кабинет креатора по макету ═══════════════════════════
  //
  // Одна страница, а не вкладки: в макете деньги, выкладки, задание и
  // переписка стоят сверху вниз одним потоком. Это не «всё сразу» —
  // это один разговор: сколько мне за это будет → что для этого надо
  // сдать → по каким правилам → и с кем поговорить, если что.

  /**
   * Открытый раздел НА ТЕЛЕФОНЕ.
   *
   * На десктопе страница одна и разделов у неё нет — там стоит весь
   * разговор сверху вниз, как в макете. Телефон тот же разговор не
   * прокручивает, поэтому разделы показываются по одному; переключает их
   * нижняя полоса, а прячет — тач-слой по data-sec. Десктоп про этот
   * сигнал просто не знает.
   */
  public readonly section = signal('money');

  public readonly phoneTabs: readonly SotkaTab[] = [
    { key: 'money', title: 'Деньги', icon: 'coin' },
    { key: 'posts', title: 'Выкладки', icon: 'cal' },
    { key: 'brief', title: 'Задание', icon: 'doc' },
    { key: 'talk', title: 'Переписка', icon: 'chat' },
  ];

  public readonly digits = groupDigits;

  public readonly short = shortViews;

  public readonly ladderStep = LADDER_STEP;

  public readonly nav = computed<SotkaNavItem[]>(() => [
    { title: 'Мои проекты', link: '/me/creator/projects' },
    {
      title: this.card()?.title ?? 'Проект',
      link: `/me/creator/projects/${this.projectId()}`,
      current: true,
    },
  ]);

  // ---- деньги периода ----

  /** Своё начисление за текущий период. Нет строки — не посчитано. */
  public readonly earned = computed(() => {
    const p = this.period();
    const rows = this.earnings()?.accruals ?? [];
    if (!p) return null;
    return rows.find((a) => a.period_start.slice(0, 10) === p.starts_on.slice(0, 10)) ?? null;
  });

  /** Что заработано у КРЕАТОРА: его сторона тарифа, не клиентская. */
  public readonly payout = computed(() => {
    const row = this.earned();
    if (!row) return null;
    return {
      salary: row.payout_salary ?? row.salary,
      bonus:
        (row.payout_views_bonus ?? row.views_bonus) + (row.payout_click_bonus ?? row.click_bonus),
      deduction: row.payout_deduction ?? row.deduction,
      total: row.payout_total ?? row.total,
      videosPlanned: row.videos_planned,
      videosDelivered: row.videos_delivered,
    };
  });

  private readonly allVideos = computed<LadderVideo[]>(() =>
    this.items()
      .filter((p) => p.status !== 'cancelled' && !!p.published_at)
      .map((p) => ({ id: p.id, title: p.title, views: p.views, published_at: p.published_at })),
  );

  public readonly periodVideos = computed(() => videosInPeriod(this.allVideos(), this.period()));

  /** Перенос с прошлого периода уже в счёте ступеней. */
  public readonly carryIn = computed(() => this.period()?.carry_in_creator ?? 0);

  public readonly viewsNow = computed(
    () => this.carryIn() + this.periodVideos().reduce((s, v) => s + v.views, 0),
  );

  public readonly ladder = computed(() => ladderState(this.viewsNow()));

  public readonly forecast = computed(() => this.earnings()?.next_step_forecast ?? null);

  public readonly toNext = computed(() => this.forecast()?.views_to_go ?? this.ladder().toNext);

  /**
   * Лесенка: двенадцать ступеней от текущей.
   *
   * Показываем окно вокруг пройденного, а не всю историю от нуля: на
   * сороковой ступени сорок столбиков превращаются в забор, по которому
   * не видно ни своего места, ни следующей цели.
   */
  public readonly stairs = computed(() => {
    const passed = this.ladder().passed;
    const first = Math.max(1, passed - 5);
    const perStep = this.stepMoney();
    return Array.from({ length: 12 }, (_, i) => {
      const n = first + i;
      return {
        n,
        height: 14 + (i + 1) * 10,
        state: n <= passed ? 'done' : n === passed + 1 ? 'next' : n === passed + 2 ? 'ghost' : '',
        money: perStep && n <= passed + 2 ? this.money(perStep * n) : '',
        label: `${(n * LADDER_STEP) / 1000}т`,
      };
    });
  });

  /**
   * Сколько денег даёт ступень.
   *
   * Берём из ступенчатого тарифа его стороны, если он выпущен: там цена
   * ступени названа прямо. Иначе — из ставки за тысячу, но только когда
   * она есть: выдуманная цена ступени здесь хуже пустого места, по ней
   * человек считает свою зарплату.
   */
  public readonly stepMoney = computed(() => {
    const t = this.earnings()?.terms;
    if (!t) return 0;
    const steps = t.steps ?? [];
    if (steps.length >= 2) {
      const diff = steps[1].fee - steps[0].fee;
      return diff > 0 ? diff : 0;
    }
    return t.rate_per_1000_views ? Math.round((t.rate_per_1000_views * LADDER_STEP) / 1000) : 0;
  });

  /** Что даст следующий ролик: прогноз сервера, а не наша арифметика. */
  public readonly nextVideoGain = computed(() => this.forecast()?.forecast_payout ?? 0);

  public readonly typical = computed(() => this.earnings()?.benchmark ?? null);

  /**
   * «Сколько обычно даёт ваш ролик».
   *
   * Сначала СВОЯ медиана — по всем роликам этого креатора. Её считает
   * сервер и отдаёт вместе с карточкой проекта. Подпись «по вашей
   * медиане» до сих пор стояла над типовым числом из справочника, то
   * есть над чужим: своё и среднее по площадке — разные величины, и
   * человек считает по этой строке свою зарплату.
   *
   * null — измеренных роликов мало, и медианы нет. Тогда строка честно
   * говорит про справочник, а не выдаёт его за личное.
   */
  public readonly myMedian = computed(() => this.card()?.median ?? null);

  // ---- плашка прошлого месяца ----

  /** Начисление за прошлый период: сколько и в каком оно состоянии. */
  public readonly closedRow = computed(() => {
    const prev = this.lastClosed()?.period;
    if (!prev) return null;
    const rows = this.earnings()?.accruals ?? [];
    return rows.find((a) => a.period_start.slice(0, 10) === prev.starts_on.slice(0, 10)) ?? null;
  });

  // ---- календари трёх месяцев ----

  public readonly weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Три месяца подряд: прошлый, текущий, следующий.
   *
   * Ровно как в макете, и это не украшение: выкладки живут по месяцам, и
   * человеку надо видеть, что было, что идёт и что уже назначено дальше,
   * — иначе «свободных дней в сентябре» он не найдёт.
   */
  public readonly months = computed(() => {
    const now = new Date();
    const names = [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ];
    const todayKey = this.dayKey(now);
    const byDate = new Map<string, Publication[]>();
    for (const p of this.ordered()) {
      const k = p.due_date.slice(0, 10);
      byDate.set(k, [...(byDate.get(k) ?? []), p]);
    }

    return [-1, 0, 1].map((shift) => {
      const base = new Date(now.getFullYear(), now.getMonth() + shift, 1);
      const key = this.monthKey(base);
      const days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const blanks = (base.getDay() + 6) % 7;
      const cells = Array.from({ length: days }, (_, i) => {
        const num = i + 1;
        const date = `${key}-${String(num).padStart(2, '0')}`;
        const pubs = byDate.get(date) ?? [];
        return {
          num,
          date,
          today: date === todayKey,
          state: this.dayState(pubs, date, todayKey),
          hint: pubs.length ? pubs.map((p) => p.title || 'выкладка').join(', ') : '',
        };
      });
      const total = cells.filter((c) => c.state).length;
      return {
        key,
        name: `${names[base.getMonth()]} ${base.getFullYear()}`,
        blanks: Array.from({ length: blanks }, (_, i) => i),
        cells,
        total,
      };
    });
  });

  /** Состояние дня в календаре: вышел, просрочен, в плане, назначен. */
  private dayState(pubs: Publication[], date: string, today: string): string {
    if (!pubs.length) return '';
    if (pubs.some((p) => p.status === 'done' || p.status === 'closed_manually')) return 'd';
    if (pubs.some((p) => p.overdue)) return 'l';
    if (date < today) return 'l';
    return 'p';
  }

  private dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }

  // ---- два списка выкладок ----

  /** Что надо сдать: несданное, ближний срок первым. */
  public readonly plannedList = computed(() => this.ordered().filter((p) => !this.isDone(p)));

  /** Что вышло: свежее первым, с разделителями по периодам. */
  public readonly doneList = computed(() =>
    [...this.ordered().filter((p) => this.isDone(p))].reverse(),
  );

  /** Ближайший несданный — у него в списке синяя дата. */
  public readonly nearestId = computed(() => {
    const today = this.dayKey(new Date());
    const next = this.plannedList().find((p) => p.due_date.slice(0, 10) >= today);
    return next?.id ?? '';
  });

  public dayNum(date: string): string {
    return date.slice(8, 10);
  }

  public dayWord(date: string): string {
    const d = new Date(`${date.slice(0, 10)}T00:00:00`);
    const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()] ?? '';
    const mo = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][
      d.getMonth()
    ];
    return `${wd} · ${mo}`;
  }

  /** Вид плашки даты: просрочено, ближайшее, сдано, просто план. */
  public dateTone(pub: Publication): string {
    if (this.isDone(pub)) return 'done';
    if (pub.overdue) return 'crit';
    if (pub.id === this.nearestId()) return 'next';
    return '';
  }

  // ---- свои аккаунты ----

  /** Ссылка на свой аккаунт площадки. Пусто — площадка не привязана. */
  // ---- лучший и худший ролик ----

  public readonly bestWorst = computed(() => {
    const vs = this.periodVideos().filter((v) => v.views > 0);
    if (vs.length < 2) return null;
    const sorted = [...vs].sort((a, b) => b.views - a.views);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  });

  // Выкладки в порядке дедлайна: номер «Выкладка 03» — это позиция в
  // расписании, отдельного поля с номером или темой ролика в API нет.
  //
  // Отменённые не показываем: их сняли с плана, сдавать по ним нечего, а
  // в списке они путали нумерацию и создавали пары «та же дата, но одна
  // отменена».
  public readonly ordered = computed(() =>
    this.items()
      .filter((p) => p.status !== 'cancelled')
      .sort((a, b) => a.due_date.localeCompare(b.due_date)),
  );

  /**
   * Порядок НА ЭКРАНЕ: сначала то, что надо сдать, потом сданное.
   *
   * `ordered()` этого делать не может и не должна: по ней считается
   * номер выкладки («Выкладка 03» — это позиция в расписании), и стоит
   * её пересортировать, как номера поедут. Поэтому список для показа —
   * отдельный, а нумерация по-прежнему идёт от расписания.
   *
   * Зачем: двенадцать сделанных карточек и одна несделанная отличались
   * только цветом рамки, и несделанная лежала последней — за четырьмя
   * тысячами пикселей прокрутки. То, что надо сделать сегодня, обязано
   * стоять первым.
   *
   * Внутри каждой из двух групп порядок расписания сохраняется: ближний
   * срок раньше дальнего.
   */
  public readonly displayed = computed(() => {
    const rows = this.ordered();
    return [...rows.filter((p) => !this.isDone(p)), ...rows.filter((p) => this.isDone(p))];
  });

  public readonly closed = computed(() => closedCount(this.items()));

  /**
   * Сколько выкладок ещё не сдано — счётчик на вкладке.
   *
   * Список ушёл под вкладку, и без этого числа человек не знает, надо ли
   * туда заходить вообще: раньше несданная карточка попадалась на глаза
   * сама. Считаем по тому же isDone, что и порядок в списке, — иначе
   * счётчик и список назвали бы разные выкладки несданными.
   */
  public readonly openCount = computed(() => this.ordered().filter((p) => !this.isDone(p)).length);

  public readonly total = computed(
    () => this.items().filter((p) => p.status !== 'cancelled').length,
  );

  public readonly links = computed(() => linksCollected(this.items()));

  // Что показывать: карта блоков по роли. У креатора нет ни ленты, ни
  // календаря, ни настроек уведомлений — соответствующих ручек в API нет.
  // Вид проекта берём из карточки: догадка по наличию выкладок убрана.
  //
  // Пока карточка не пришла, вида нет — и блоков нет тоже. Умолчание
  // «считать проект креаторским» было опасным: проект любого другого
  // вида успевал нарисоваться как turnkey — с чеклистом и выкладками,
  // которых у него не бывает, — и схлопывался, когда карточка доезжала.
  public readonly blocks = computed(() =>
    projectBlocks('creator', {
      kind: this.card()?.kind,
      statsAllowed: !this.reportCollapsed(),
    }),
  );

  // Площадки ролика: список приходит с карточкой, чтобы у фронта не было
  // своей копии порядка колонок. До ответа держим свой — иначе таблица
  // ссылок при загрузке схлопывается в пустоту.
  public readonly projectPlatforms = computed<readonly Platform[]>(
    () => this.card()?.platforms ?? ALL_PLATFORMS,
  );

  // «6 из 12» в шапке: план месяца из договора. Без карточки его взять
  // было неоткуда, и знаменателем стояло число проставленных выкладок.
  public readonly monthlyPlan = computed(() => this.card()?.monthly_plan ?? 0);

  // Самая горящая открытая выкладка: сначала просроченные, потом ближайшая
  // по сроку. Её и называет строка «что дальше».
  // Тип указан явно: без него TypeScript считает, что open[0] всегда
  // есть, и `urgent()?.overdue` в шаблоне становится «лишним» вопросом —
  // при том что на проекте без открытых выкладок здесь ровно null.
  public readonly urgent = computed<Publication | null>(() => {
    const open = this.ordered().filter((p) => canSubmitLinks(p));
    return open.find((p) => p.overdue) ?? open[0] ?? null;
  });

  /**
   * Через сколько дней срок считается «ближайшим».
   *
   * Три дня, потому что ролик за это время ещё можно снять и выложить.
   * Выкладка, до которой две недели, ближайшим делом не является: назвать
   * её так значит держать человека в режиме аврала постоянно, и тогда
   * настоящий аврал ничем не отличается от обычного дня.
   */
  private readonly soonDays = 3;

  /**
   * По выкладке ждут ссылки ПРЯМО СЕЙЧАС.
   *
   * Три случая: просрочена, сдана наполовину (часть площадок уже есть, и
   * дослать их можно сегодня) или срок в ближайшие дни. Иначе ближайшим
   * делом становится то, что человек может сделать по своей воле, —
   * добрать до ступени или заполнить площадку в профиле.
   */
  public readonly pendingNow = computed(() => {
    const u = this.urgent();
    if (!u) return false;
    return u.overdue || u.links.length > 0 || this.daysDiff(u) <= this.soonDays;
  });

  /**
   * Одно ближайшее действие, и только одно. Порядок выбора — в
   * nextStepKind: работа, за которую спросят, идёт раньше денег, которые
   * человек может взять сам.
   *
   * null — делать прямо сейчас нечего, и придумывать занятие не надо.
   */
  public readonly nextStep = computed(() =>
    nextStepKind({
      hasPending: this.pendingNow(),
      missingAccounts: this.missingAccounts().length,
    }),
  );

  /**
   * Доли полосы прогресса. Считаются по выкладкам, а не по ссылкам:
   * закрывается ролик целиком, и полоса должна отвечать на вопрос
   * «сколько роликов сдано», а не «сколько ссылок собрано».
   */
  public sharePercent(part: 'done' | 'part' | 'late'): number {
    const all = this.ordered();
    if (!all.length) return 0;
    const n = all.filter((p) => {
      const tone = publicationBadge(p).tone;
      if (part === 'done') return tone === 'ok';
      if (part === 'late') return tone === 'late';
      return p.links.length > 0 && tone !== 'ok' && tone !== 'late';
    }).length;
    return (n / all.length) * 100;
  }

  /** Сколько дней до срока; отрицательное — просрочка. */
  public daysLeft(pub: Publication): string {
    const days = this.daysDiff(pub);
    return days < 0 ? `−${Math.abs(days)}` : String(days);
  }

  // Форма слова — общим хелпером: своя копия правила здесь уже была
  // третьей в репозитории, и все три пришлось бы чинить порознь.
  public daysWord(pub: Publication): string {
    return plural(this.daysDiff(pub), 'день', 'дня', 'дней');
  }

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  private daysDiff(pub: Publication): number {
    const due = new Date(pub.due_date);
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86_400_000);
  }

  /** «ни одной ссылки» / «собрано 3 из 5» — то, что видно в баннере. */
  public collectedLabel(pub: Publication): string {
    const have = pub.links.length;
    const all = this.projectPlatforms().length;
    return have ? `собрано ${have} из ${all}` : 'ни одной ссылки';
  }

  public urgentHint(pub: Publication): string {
    const when = dueLabel(pub.due_date);
    return pub.overdue
      ? `Надо было выложить ${when}. Сдайте ссылки или попросите новую дату.`
      : `Выложить ${when}. Можно сдать не все площадки сразу.`;
  }

  /** Ссылка в строке площадки — без схемы: она везде одна и та же. */
  public shortUrl(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  }

  public materialShort(kind: string): string {
    if (kind === 'video') return 'MP4';
    if (kind === 'link') return 'URL';
    return 'DOC';
  }

  /** Переписка внизу страницы: кнопка «Написать» ведёт туда же. */
  /**
   * «Написать» в шапке проекта.
   *
   * Раньше прокручивала к якорю #talk в подвале простыни. Теперь
   * переписка — вкладка, и прокручивать некуда: она открывается прямо
   * под шапкой, из которой на кнопку и нажали. Прокрутка к якорю здесь
   * не просто лишняя — она искала бы элемент, которого на общей вкладке
   * в DOM нет, и кнопка молча не делала бы ничего.
   */
  public index(pub: Publication): string {
    const i = this.ordered().findIndex((p) => p.id === pub.id);
    return String(i + 1).padStart(2, '0');
  }

  public badge(pub: Publication) {
    return publicationBadge(pub);
  }

  public due(date: string): string {
    return dueLabel(date);
  }

  public isLate(date: string): boolean {
    return daysLeft(date) < 0;
  }

  public link(pub: Publication, platform: Platform) {
    return linkFor(pub, platform);
  }

  public missing(pub: Publication): Platform[] {
    return missingPlatforms(pub);
  }

  public canSubmit(pub: Publication): boolean {
    return canSubmitLinks(pub);
  }

  public isDone(pub: Publication): boolean {
    return isClosed(pub);
  }

  /**
   * Сданные выкладки свёрнуты в одну строку — НА ТЕЛЕФОНЕ.
   *
   * Одиннадцать одинаковых карточек «5 из 5 собрано» на 390 px — это
   * метры прокрутки мимо единственного, ради чего экран и открыли:
   * выкладки, которую сдают сегодня. Сами карточки никуда не делись, их
   * разворачивает строка-итог под списком.
   *
   * Какое-то время сворачивали и на десктопе: список лежал посреди
   * простыни, и сданное стояло между человеком и деньгами. Теперь список
   * — своя вкладка, денег под ним нет, а свёрнутый до одной строки он
   * оставляет вкладку пустой: человек нажал «Мои выкладки» и увидел, что
   * выкладок будто бы нет. Признак размера держит css (см. .foldrow и
   * .slotcard.mdone), сигнал здесь — общий для обоих: два разных
   * состояния на одну кнопку разошлись бы при первом же повороте
   * телефона.
   */
  public readonly doneFolded = signal(true);

  public toggleDoneFold(): void {
    this.doneFolded.set(!this.doneFolded());
  }

  public readonly expanded = signal<Set<string>>(new Set());

  public toggle(pub: Publication): void {
    const next = new Set(this.expanded());
    if (next.has(pub.id)) next.delete(pub.id);
    else next.add(pub.id);
    this.expanded.set(next);
  }

  public isExpanded(pub: Publication): boolean {
    return this.expanded().has(pub.id);
  }

  // Сумма по всем площадкам ролика приходит в самой выкладке — складывать
  // её из videos_table значило бы держать вторую реализацию правила, по
  // которому считается порог «миллион на ролик».
  public statsOf(
    pub: Publication,
  ): { views: number; likes: number; er?: number; erWithoutShares: boolean } | null {
    if (!pub.links.length) return null;
    // ER берём у сервера: он считает (лайки + комментарии + репосты) ÷
    // просмотры. Своя формула из лайков здесь уже расходилась с отчётом
    // на тех же роликах, а с приходом репостов разошлась бы сильнее.
    return {
      views: pub.views,
      likes: pub.likes,
      er: pub.er_percent,
      erWithoutShares: !!pub.er_without_shares,
    };
  }

  public viewsOf(pub: Publication, platform: Platform): number | null {
    const rep = this.report();
    if (!rep) return null;
    const row = rep.videos_table.find(
      (r) => r.publication_id === pub.id && r.platform === platform,
    );
    return row ? row.views : null;
  }

  // ---- сдача ссылок ----

  public readonly submitFor = signal<Publication | null>(null);

  public readonly urls = signal<Record<Platform, string>>(this.emptyUrls());

  public readonly checked = signal<Set<string>>(new Set());

  // Пункты, которые бэк назвал незакрытыми в 422 checklist_incomplete:
  // подсвечиваем именно их, а не весь список.
  public readonly flagged = signal<Set<string>>(new Set());

  public readonly commonChecklist = computed(() => commonItems(this.checklist()));

  /**
   * У проекта нет ни одного пункта чеклиста.
   *
   * Отдельное состояние, а не пустой список. Чеклист снимается с шаблона
   * в момент заведения проекта; шаблон не подключили — пунктов нет
   * вовсе, и окно сдачи молча открывалось без единого требования.
   * Молчание тут читается двумя способами сразу, и оба вредные: креатор
   * решит, что требований нет, а менеджер — что тот их проигнорировал.
   */
  // ---- решение менеджера по ролику ----
  //
  // Менеджер возвращает ролик с замечанием — «00:00–00:03 логотипа нет,
  // перемонтируй начало». Слова эти до сих пор не показывались КРЕАТОРУ
  // нигде: возврат без замечания сервер не принимает, а замечание без
  // места, где его читают, бесполезно ровно так же.

  /** Ролики, возвращённые на доработку. Первое дело в кабинете. */
  public readonly returned = computed(() =>
    this.ordered().filter((p) => p.review?.status === 'returned'),
  );

  /** Подпись решения по ролику. Пусто — решения ещё нет. */
  public reviewLabel(pub: Publication): string {
    switch (pub.review?.status) {
      case 'accepted':
        return 'принят';
      case 'returned':
        return 'вернули';
      case 'in_review':
        return 'на проверке';
      default:
        return '';
    }
  }

  public reviewTone(pub: Publication): string {
    switch (pub.review?.status) {
      case 'accepted':
        return 'ok';
      case 'returned':
        return 'crit';
      default:
        return 'neu';
    }
  }

  public readonly noChecklist = computed(() => this.checklist().length === 0);

  public itemsFor(platform: Platform): ChecklistItem[] {
    return itemsForPlatform(this.checklist(), platform);
  }

  private emptyUrls(): Record<Platform, string> {
    return { tiktok: '', instagram: '', youtube: '', vk: '', likee: '' };
  }

  /**
   * Название ролика.
   *
   * Тему выкладки задаёт дата, и до съёмки названия нет. После — оно
   * единственное, по чему ролик можно отличить: в ленте заказчика иначе
   * двенадцать строк «Выкладка 07». Знает его только тот, кто снимал.
   */
  public title = '';

  public openSubmit(pub: Publication): void {
    this.submitFor.set(pub);
    // Досылая площадки, креатор видит то, что вписал в первый заход.
    this.title = pub.title ?? '';
    const filled = this.emptyUrls();
    for (const l of pub.links) filled[l.platform] = l.url;
    this.urls.set(filled);
    this.checked.set(new Set());
    this.flagged.set(new Set());
  }

  public closeSubmit(): void {
    this.submitFor.set(null);
  }

  // ---- пересдача ссылки ----
  //
  // Ролик удаляют с площадки, аккаунт перевыкладывают, короткая ссылка
  // протухает — и новый адрес есть ровно у автора. Раньше он писал его в
  // переписку, а менеджер переносил руками: лишний шаг, на котором
  // ссылка живёт в чате, а не в сервисе.

  /** Какую площадку сейчас пересдаём. null — никакую. */
  public readonly editingLink = signal<Platform | null>(null);

  public readonly linkBusy = signal(false);

  public startEditLink(pub: Publication, platform: Platform): void {
    if (this.editingLink() === platform) {
      this.editingLink.set(null);
      return;
    }
    // Подставляем текущий адрес: чаще всего правят его, а не вставляют
    // с нуля — у ролика меняется хвост, а не весь путь.
    this.setUrl(platform, this.link(pub, platform)?.url ?? '');
    this.editingLink.set(platform);
  }

  public saveEditedLink(pub: Publication, platform: Platform): void {
    const url = this.urlValue(platform).trim();
    if (!url || this.linkBusy()) return;
    this.linkBusy.set(true);
    this.api.creatorEditLink(pub.id, platform, url).subscribe({
      next: () => {
        this.linkBusy.set(false);
        this.editingLink.set(null);
        this.setUrl(platform, '');
        this.msg.success('Ссылка пересдана.');
        this.fetch(this.projectId(), true);
      },
      error: (e) => {
        this.linkBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось переслать ссылку.').message);
      },
    });
  }

  public urlValue(platform: Platform): string {
    return this.urls()[platform];
  }

  public setUrl(platform: Platform, value: string): void {
    this.urls.set({ ...this.urls(), [platform]: value });
  }

  public toggleItem(item: ChecklistItem): void {
    const next = new Set(this.checked());
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    this.checked.set(next);
    if (this.flagged().has(item.id)) {
      const f = new Set(this.flagged());
      f.delete(item.id);
      this.flagged.set(f);
    }
  }

  public isChecked(item: ChecklistItem): boolean {
    return this.checked().has(item.id);
  }

  public isFlagged(item: ChecklistItem): boolean {
    return this.flagged().has(item.id);
  }

  // Площадки, которые сейчас сдаются: только те, где поле не пустое и
  // ссылки ещё не было.
  public readonly submittingPlatforms = computed<Platform[]>(() => {
    const pub = this.submitFor();
    if (!pub) return [];
    const already = new Set(pub.links.map((l) => l.platform));
    const filled = this.urls();
    return ALL_PLATFORMS.filter((p) => !already.has(p) && filled[p].trim().length > 0);
  });

  public readonly blockingItems = computed(() =>
    requiredUnchecked(this.checklist(), this.submittingPlatforms(), this.checked()),
  );

  public readonly submitHint = computed(() => {
    if (!this.submittingPlatforms().length) return 'Вставьте хотя бы одну новую ссылку.';
    const left = this.blockingItems().length;
    if (left) return `Не отмечено обязательных пунктов: ${left}.`;
    return `Сдаём ${this.submittingPlatforms().length} из ${ALL_PLATFORMS.length} площадок.`;
  });

  public readonly canSend = computed(
    () => this.submittingPlatforms().length > 0 && this.blockingItems().length === 0,
  );

  public send(): void {
    const pub = this.submitFor();
    if (!pub || !this.canSend()) return;
    const urls = this.submittingPlatforms().map((p) => this.urls()[p].trim());
    this.busy.set(true);
    this.api.creatorSubmitLinks(pub.id, urls, [...this.checked()], this.title.trim()).subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.submitFor.set(null);
        this.items.set(this.items().map((p) => (p.id === saved.id ? saved : p)));
        this.msg.success(
          saved.status === 'done'
            ? 'Ролик закрыт — приняты все площадки, статистика подтянется утром.'
            : `Принято ${saved.links.length} из ${ALL_PLATFORMS.length} — остальные можно дослать позже.`,
        );
        this.reloadReport();
      },
      error: (e) => {
        this.busy.set(false);
        const err = parseApiError(e, 'Не удалось сдать ссылки.');
        // 422: message перечисляет незакрытые пункты — подсвечиваем их и
        // оставляем окно открытым.
        if (err.code === 'checklist_incomplete') {
          this.flagged.set(new Set(this.matchItemsFromMessage(err.message)));
          this.msg.error(err.message);
          return;
        }
        // 409: выкладку закрыли, пока окно было открыто. Перечитываем —
        // кнопка сдачи после этого исчезнет сама.
        if (err.code === 'publication_closed') {
          this.submitFor.set(null);
          this.msg.error(err.message);
          this.fetch(this.projectId(), true);
          return;
        }
        this.msg.error(err.message);
      },
    });
  }

  // Бэк перечисляет незакрытые пункты текстом. Сопоставляем по тексту
  // пункта: id в сообщении нет.
  private matchItemsFromMessage(message: string): string[] {
    return this.checklist()
      .filter((i) => i.is_required && message.includes(i.text))
      .map((i) => i.id);
  }

  // ---- просьба о переносе ----

  public readonly dateFor = signal<Publication | null>(null);

  /**
   * Новая дата — объектом, а не строкой: поле теперь nz-date-picker.
   *
   * Было `<input type="date">` — единственное нативное поле даты во всём
   * приложении. Chrome рисует у него свой календарь: белый, с синим
   * выделением, мимо всей тёмной темы, и выключить это нельзя.
   */
  public newDate: Date | null = null;

  public dateReason = '';

  /** Задним числом дату не просят: перенос бывает только вперёд. */
  public readonly disabledPastDates = (current: Date): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return current.getTime() < today.getTime();
  };

  public openDateRequest(pub: Publication): void {
    this.dateFor.set(pub);
    this.newDate = null;
    this.dateReason = '';
  }

  public closeDateRequest(): void {
    this.dateFor.set(null);
  }

  public sendDateRequest(): void {
    const pub = this.dateFor();
    if (!pub) return;
    if (!this.newDate) {
      this.msg.error('Укажите новую дату выкладки.');
      return;
    }
    if (!this.dateReason.trim()) {
      this.msg.error('Напишите, что случилось — без причины менеджер не поймёт.');
      return;
    }
    this.busy.set(true);
    // ГГГГ-ММ-ДД в локальном времени: toISOString сдвигает дату на UTC,
    // и в плюсовых поясах просьба уезжала бы на день назад.
    const requested = ymdLocal(this.newDate);
    this.api.creatorRequestDate(pub.id, requested, this.dateReason.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.dateFor.set(null);
        this.msg.success('Запрос ушёл менеджеру. Пока он не ответил, выкладка не просрочена.');
        this.fetch(this.projectId(), true);
      },
      error: (e) => {
        this.busy.set(false);
        const err = parseApiError(e, 'Не удалось отправить запрос.');
        if (err.code === 'already_requested') {
          this.dateFor.set(null);
          this.fetch(this.projectId(), true);
        }
        this.msg.error(err.message);
      },
    });
  }

  // ---- своя выкладка сверх плана ----
  //
  // План ставит менеджер. Эта кнопка про другое: план периода выполнен, а
  // до ступени не хватило, и добрать нечем — новых дат впереди нет.
  //
  // Поэтому первым в окне стоит не поле даты, а правило про деньги:
  // трогает это только бонусы, оклад считается по плановым выкладкам, и
  // добавить и не сдать — не штрафуется. Без этой фразы кнопку не
  // нажмут, и правильно сделают: в чужих системах такое обычно
  // наказывается.

  public readonly addOpen = signal(false);

  /** Дата новой выкладки. Сигнал, а не поле: от неё зависят проверки. */
  public readonly addDate = signal<Date | null>(null);

  /**
   * Прошлое и «дальше года вперёд» календарь не отдаёт.
   *
   * Те же границы держит сервер (400 invalid_input), и это не дубль
   * правила, а его место: отказ, прилетевший на день, который пикер
   * показал выбираемым, человек относит к сбою, а не к своей дате.
   */
  public readonly disabledAddDates = (current: Date): boolean => isDisabledDay(current);

  /**
   * Своя выкладка на выбранный день уже есть.
   *
   * Сервер ответит тем же (409 day_taken), но сказать это можно сразу и
   * прямо в окне: список своих выкладок у страницы уже загружен.
   */
  public readonly addTaken = computed(() => {
    const d = this.addDate();
    return d ? takenOn(this.items(), ymdLocal(d)) : null;
  });

  /** Сколько в чеклисте обязательных пунктов — их не обойти при сдаче. */
  public readonly requiredItems = computed(
    () => this.checklist().filter((i) => i.is_required).length,
  );

  public readonly canAdd = computed(() => !!this.addDate() && !this.addTaken());

  public openAddPublication(): void {
    this.addDate.set(null);
    this.addOpen.set(true);
  }

  public closeAddPublication(): void {
    this.addOpen.set(false);
  }

  /** Выкладку завёл себе сам креатор, а не поручил менеджер. */
  public selfAdded(pub: Publication): boolean {
    return isSelfAdded(pub);
  }

  public addPublication(): void {
    const d = this.addDate();
    if (!d || !this.canAdd()) return;
    this.busy.set(true);
    this.api.creatorAddPublication(this.projectId(), ymdLocal(d)).subscribe({
      next: (created) => {
        this.busy.set(false);
        this.addOpen.set(false);
        this.items.set([...this.items(), created]);
        // И сразу показываем КУДА добавили.
        //
        // Кнопка добора стоит в карточке заработка — там числа, ради
        // которых ролик и добирают. На десктопе список выкладок стоит
        // прямо под ней, а на телефоне это соседний раздел: без этого
        // перехода человек нажимал «Добавить ролик», получал всплывашку
        // и смотрел на неизменившийся экран.
        this.section.set('posts');
        this.msg.success('Выкладка добавлена. Сдадите ссылки, когда ролик выйдет.');
      },
      error: (e) => {
        this.busy.set(false);
        // Текст отказа берём у сервера: он знает и про занятый день, и
        // про подытоженный период, и про состав проекта. Свой пересказ
        // разошёлся бы с ним на первой же правке правил.
        const err = parseApiError(e, 'Не удалось добавить выкладку.');
        // День заняли, пока окно было открыто (например, в соседней
        // вкладке). Перечитываем список — предупреждение про занятый
        // день встанет на место само.
        if (err.code === 'day_taken') this.fetch(this.projectId(), true);
        this.msg.error(err.message);
      },
    });
  }

  // ---- загрузка ----

  private reloadReport(): void {
    this.api.creatorReport(this.projectId()).subscribe({
      next: (r) => this.report.set(r),
      error: () => undefined,
    });
  }

  private fetch(id: string, quiet = false): void {
    if (!quiet) this.loading.set(true);
    this.api.creatorProjectCard(id).subscribe({
      next: (c) => {
        this.card.set(c);
        this.notFound.set(false);
      },
      // Карточки нет — значит проекта нет или мы не в его составе.
      // Показываем это прямо, а не пустую страницу с нулями.
      error: (e) => {
        this.card.set(null);
        this.notFound.set(parseApiError(e, '').code === 'not_found');
      },
    });
    forkJoin({
      pubs: this.api.creatorList(id),
      checklist: this.api.creatorChecklist(id),
    }).subscribe({
      next: ({ pubs, checklist }) => {
        this.items.set(pubs.items);
        this.checklist.set([...checklist.items].sort((a, b) => a.sort_order - b.sort_order));
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        // Если проекта нет, про это уже сказано на самой странице —
        // второе сообщение поверх было бы шумом об одной причине.
        if (!this.notFound()) {
          this.msg.error(parseApiError(e, 'Не удалось загрузить выкладки.').message);
        }
      },
    });
    this.api.creatorMaterials(id).subscribe({
      next: (r) => this.materials.set(r.items),
      error: () => this.materials.set([]),
    });
    this.loadSuggestions(id);
    // Аккаунты проекта: по ним считается, каких площадок не хватает.
    // Молча: блок «Мои аккаунты» рисует себя сам и сам же скажет о сбое.
    this.api.creatorAccounts(id).subscribe({
      next: (r) => {
        this.projectAccounts.set(r.items ?? []);
        this.accountsLoaded.set(true);
      },
      error: () => this.accountsLoaded.set(false),
    });
    // Профиль грузим отдельно и молча: он нужен ровно одному блоку, и
    // ронять из-за него страницу выкладок незачем. Не пришёл — блока про
    // незаполненные площадки просто нет.
    this.me.getProfile().subscribe({
      next: (p) => this.profile.set(p),
      error: () => this.profile.set(null),
    });
    this.billing.creatorEarnings(id).subscribe({
      next: (e) => this.earnings.set(e),
      // Денег может не быть вовсе: тариф проекту ещё не задали. Это не
      // сбой — блок просто не показывается.
      error: () => this.earnings.set(null),
    });
    this.api.creatorReport(id).subscribe({
      next: (r) => {
        this.report.set(r);
        this.reportCollapsed.set(r.collapsed);
      },
      error: (e) => {
        const err = parseApiError(e, '');
        // 410 — проект закрыт и подробные строки удалены. Это не сбой,
        // ругаться на него не за что.
        if (err.code === 'collapsed_no_detail') this.reportCollapsed.set(true);
      },
    });
  }
}
