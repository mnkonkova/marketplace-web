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

import { Router, RouterLink } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney } from '@entities/billing/lib/money';
import {
  canApprove,
  canMarkPaid,
  isPreviewPeriod,
  recalcAffects,
  shortfall,
} from '@entities/billing/lib/money';
import { periodSettled, periodTitle } from '@entities/billing/lib/period';
import type { Accrual, PeriodTotals, Payment } from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ProjectPerson, Publication } from '@entities/publication/model/publication.types';
import { ProjectApi } from '@entities/project/api/project.api';
import type {
  ProjectEvent,
  ProjectFullView,
  ProjectManagerView,
} from '@entities/project/model/project.types';
import { closedCount, daysLeft } from '@entities/publication/lib/publication-status';
import { plural } from '@shared/lib/format';

/** Действие тревоги: пинг всем или переход на нужную вкладку. */
interface ManagerAlertAction {
  title: string;
  kind: 'primary' | 'quiet';
  act: 'remind' | 'plan' | 'pay' | 'review';
}

/** Карточка тревоги: что горит, на сколько и что с этим делать. */
interface ManagerAlert {
  key: string;
  // 'info' — не тревога, а состояние, требующее действия: ролик лежит
  // возвращённым, и пока по нему не переснимут, он никуда не двинется.
  tone: 'crit' | 'warn' | 'info';
  label: string;
  /** Число или сумма — то, ради чего карточку и читают. */
  value: string;
  valueNote: string;
  text: string;
  actions: ManagerAlertAction[];
}
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';
import { ProjectAccountsComponent } from '@widgets/project-accounts/project-accounts.component';
import { ProjectChecklistComponent } from '@widgets/project-checklist/project-checklist.component';
import { ProjectMaterialsComponent } from '@widgets/project-materials/project-materials.component';
import { ProjectReviewComponent } from '@widgets/project-review/project-review.component';
import { ProjectAutopingComponent } from '@widgets/project-autoping/project-autoping.component';
import { ProjectLinksComponent } from '@widgets/project-links/project-links.component';
import { PublicationPlanComponent } from '@widgets/publication-plan/publication-plan.component';
import { SotkaAvaComponent } from '@shared/ui/sotka-ava/sotka-ava.component';
import { SotkaTopComponent, SotkaNavItem } from '@widgets/sotka-top/sotka-top.component';
import { SotkaTabbarComponent, SotkaTab } from '@widgets/sotka-tabbar/sotka-tabbar.component';
import { groupDigits } from '@entities/billing/lib/money';
import { periodRange } from '@entities/billing/lib/period';
import type { BillingPeriod } from '@entities/billing/model/billing.types';
import {
  ALL_PLATFORMS,
  type AccountLinks,
  type Platform,
} from '@entities/publication/model/publication.types';
import { PLATFORM_LABEL, PLATFORM_SHORT } from '@entities/publication/lib/publication-status';
import { parseApiError } from '@shared/api/api-error';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzDrawerService } from 'ng-zorro-antd/drawer';
import {
  AddCreatorDialogComponent,
  AddCreatorDialogData,
} from '@features/project-creators/add-creator.dialog';
import { isTouchDevice } from '@shared/lib/touch';

/**
 * Проект «креаторы под ключ» глазами менеджера.
 *
 * В макете этот экран собран вкладками: план выкладок, креаторы,
 * статистика, начисления, материалы, комментарии. Это не украшение — за
 * месяц у проекта набегает шестьдесят выкладок, три таблицы отчёта и
 * переписка в трёх ветках; одной лентой всё это листать невозможно.
 *
 * Вкладки постоянные: их состав не зависит от того, есть ли уже данные.
 * Пустая вкладка честно говорит, что там пусто, — исчезнувшая заставляет
 * гадать, куда делся раздел.
 *
 * Порядок вкладок — по частоте обращения, а не по важности разделов:
 * переписка нужна каждый день, а статистика, деньги и материалы — это
 * отчётность, к которой возвращаются раз в период.
 *
 * Разметка перенесена из макета ~/tmp/crm_project_manager (1).html.
 */
@Component({
  selector: 'app-manager-turnkey-project',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ProjectCommentsComponent,
    ProjectAccountsComponent,
    ProjectChecklistComponent,
    ProjectMaterialsComponent,
    ProjectReviewComponent,
    ProjectAutopingComponent,
    ProjectLinksComponent,
    PublicationPlanComponent,
    SotkaAvaComponent,
    SotkaTopComponent,
    SotkaTabbarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-turnkey-project.component.html',
  styleUrl: './manager-turnkey-project.component.scss',
})
export class ManagerTurnkeyProjectComponent {
  private readonly api = inject(PublicationApi);

  private readonly projectApi = inject(ProjectApi);

  private readonly billingApi = inject(BillingApi);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  private readonly drawer = inject(NzDrawerService);

  private readonly touch = isTouchDevice();

  public readonly project = input.required<ProjectFullView>();

  public readonly meId = input<string>('');

  /**
   * Рисовать ли свою шапку.
   *
   * Внутри CRM-оболочки её рисовать нельзя: там уже есть полоса с путём
   * и разделами, и вторая шапка над ней — это два «где я» на одном
   * экране. Отдельно страница проекта не живёт, но вход у неё один, и
   * решает вызывающий, а не виджет.
   */
  public readonly chrome = input(true);

  /** Состав проекта: он же счётчик на вкладке «Креаторы». */
  public readonly crew = signal<ProjectPerson[]>([]);

  public readonly publications = signal<Publication[]>([]);

  /** Платежи заказчика: нужны шапке, чтобы предупредить про предоплату. */
  public readonly payments = signal<Payment[]>([]);

  /**
   * Итоги периода с сервера: начисленное, просмотры, себестоимость.
   *
   * Нужны тревоге про предоплату. В ней не было ни одного числа — ни
   * сколько получено, ни сколько начислено, — то есть она сообщала, что
   * что-то не так, и не сообщала, на сколько. Складывать начисления
   * самим незачем: сервер уже отдаёт `totals` тем же расчётом, которым
   * считает выплату.
   */
  public readonly totals = signal<PeriodTotals | null>(null);

  /**
   * Сколько денег ПРИШЛО от заказчика по этому проекту.
   *
   * Только подтверждённые: выставленный, но не полученный платёж — это
   * ожидание, а не деньги, и складывать одно с другим значило бы
   * отчитаться о чужих намерениях как о поступлении.
   */
  public readonly receivedFromClient = computed(() =>
    this.payments()
      .filter((p) => p.status === 'confirmed')
      .reduce((sum, p) => sum + p.amount, 0),
  );

  /** Начислено креаторам за показанный период — итогом с сервера. */
  public readonly accruedTotal = computed(() => this.totals()?.total ?? 0);

  /** Сколько выкладок закрыто — вторая половина факта в тревоге. */
  public readonly closedCount = computed(() => closedCount(this.livePublications()));

  /** Суммы приходят в копейках: на экран — рублями. */
  public readonly money = formatMoney;

  /**
   * Действующие выкладки — то же множество, что показывает план.
   *
   * Отменённые из плана скрыты намеренно, и счётчики обязаны считать так
   * же. Пока в шапке стояло «Выкладок: 10», а в плане — «Закрыто 1 из 1,
   * отменённых скрыто: 9», экран спорил сам с собой: два числа про одно
   * и то же, и оба выглядели настоящими.
   */
  public readonly livePublications = computed(() =>
    this.publications().filter((p) => p.status !== 'cancelled'),
  );

  public readonly cancelledCount = computed(
    () => this.publications().filter((p) => p.status === 'cancelled').length,
  );

  /**
   * Боковая колонка проектов — из макета. Менеджер ведёт несколько
   * проектов сразу и прыгает между ними десятки раз за день; через
   * канбан это два перехода вместо одного.
   */
  public readonly siblings = signal<ProjectManagerView[]>([]);

  public constructor() {
    effect(() => {
      const id = this.project().id;
      if (id) this.load(id);
    });
  }

  /**
   * Что горит: выкладки, по которым срок прошёл, а ссылок нет или мало.
   * Именно с этого менеджер начинает день, поэтому строка стоит над
   * вкладками, а не внутри одной из них.
   */
  public readonly burning = computed(() =>
    this.publications().filter((p) => p.overdue && p.status !== 'cancelled'),
  );

  /**
   * Ролики, возвращённые креатору с замечанием.
   *
   * Это не просрочка и не «неполная выкладка»: ссылки сданы, срок ещё
   * не прошёл, но работа стоит и ждёт человека на той стороне.
   */
  public readonly returned = computed(() =>
    this.publications().filter((p) => p.review?.status === 'returned'),
  );

  public readonly openCount = computed(
    () =>
      this.publications().filter((p) => p.status === 'planned' || p.status === 'partial').length,
  );

  /**
   * Работа идёт, а предоплаты нет.
   *
   * Блокировки в системе нет и не будет: деньги приходят мимо неё, и
   * останавливать проект по неподтверждённому платежу мы не умеем. Но
   * молчать тоже нельзя — менеджер узнаёт про недоплату из счёта в конце
   * месяца. Поэтому предупреждаем ровно тогда, когда расхождение уже
   * возникло: выкладки заведены, а предоплата не заведена или не
   * подтверждена.
   */
  public readonly prepayment = computed(() => this.payments().find((p) => p.kind === 'prepayment'));

  public readonly prepaymentRisk = computed(() => {
    if (!this.livePublications().length) return false;
    const p = this.prepayment();
    return !p || p.status !== 'confirmed';
  });

  /** Предоплату завели, но денег не дождались — это другой текст. */
  public readonly prepaymentAwaited = computed(() => !!this.prepayment());

  /**
   * «Сегодня» — три числа, с которых начинается день: что просрочено,
   * что вышло не везде и у чего срок на носу.
   */
  public readonly today = computed(() => {
    const live = this.livePublications();
    return {
      overdue: live.filter((p) => p.overdue).length,
      partial: live.filter((p) => p.status === 'partial' && !p.overdue).length,
      soon: live.filter(
        (p) =>
          (p.status === 'planned' || p.status === 'partial') &&
          !p.overdue &&
          daysLeft(p.due_date) <= 2,
      ).length,
    };
  });

  /**
   * Сводка дня схлопывается, пока все три числа нулевые.
   *
   * На новом проекте «Просрочено 0 / Выложено частично 0 / Дедлайн ≤ 2
   * дней 0» висит неделями и приучает не смотреть в эту колонку вовсе —
   * ровно к тому дню, когда там появится ненулевое.
   */
  public readonly todayCalm = computed(() => {
    const t = this.today();
    return t.overdue + t.partial + t.soon === 0;
  });

  /**
   * «Где сейчас горит» — тревоги карточками, с суммой и действием.
   *
   * Раньше это были две узкие полосы прозой: просрочки без суммы и
   * предоплата без неё же. Менеджер начинает день с вопроса «где горит и
   * на сколько», и отвечать на него обязан первый экран — числом, а не
   * абзацем. Выдуманных чисел здесь нет: сумма показывается только там,
   * где её считает сервер (начислено, получено), в остальном стоит
   * количество.
   */
  /**
   * Просмотры проекта — то же число, что видит заказчик.
   *
   * В макете оно стоит лентой над всем экраном, и это не украшение: у
   * менеджера и заказчика числа обязаны совпадать, а совпадают они
   * только если взяты из одного места. Здесь — из итогов периода,
   * которые считает сервер.
   */
  public readonly projectViews = computed(() => this.totals()?.views ?? 0);

  /** Когда счётчики последний раз обновлялись — самый свежий сбор. */
  public readonly collectedAt = computed(() => {
    const stamps = this.publications()
      .map((p) => p.stats_collected_at)
      .filter((x): x is string => !!x)
      .sort();
    return stamps.length ? stamps[stamps.length - 1] : '';
  });

  /**
   * Счётчики площадки молчат.
   *
   * Сданная ссылка, по которой два дня не было сбора, — это не ноль
   * просмотров, это отсутствие измерения, и разница видна только
   * отсюда. Порог в два дня взят по расписанию обхода: свежий ролик
   * собирается ежедневно.
   */
  public readonly staleLinks = computed(() => {
    const edge = Date.now() - 2 * 24 * 60 * 60 * 1000;
    let count = 0;
    let oldest = '';
    for (const p of this.livePublications()) {
      for (const l of p.links ?? []) {
        const at = l.last_collected_at;
        if (at && Date.parse(at) >= edge) continue;
        count += 1;
        if (at && (!oldest || at < oldest)) oldest = at;
      }
    }
    return { count, oldest };
  });

  public readonly alerts = computed<ManagerAlert[]>(() => {
    const out: ManagerAlert[] = [];
    const t = this.today();

    if (this.burning().length) {
      // Вычеты за недосданное считает сервер: у карточки просрочек это
      // и есть «на сколько», и она обязана показывать именно её, а не
      // придуманную оценку потерянных просмотров.
      const cut = this.totals()?.deductions ?? 0;
      out.push({
        key: 'overdue',
        tone: 'crit',
        label: `Просрочено ${this.burning().length} ${plural(this.burning().length, 'ролик', 'ролика', 'роликов')}`,
        value: cut ? `−${this.money(cut)}` : String(this.burning().length),
        valueNote: cut
          ? 'вычеты за недосданное'
          : plural(this.burning().length, 'выкладка', 'выкладки', 'выкладок'),
        text: `Срок прошёл, а ссылок нет или собраны не все: ${this.burningNames()}.`,
        actions: [
          { title: 'Напомнить всем', kind: 'primary', act: 'remind' },
          { title: 'Открыть план', kind: 'quiet', act: 'plan' },
        ],
      });
    }

    if (this.prepaymentRisk()) {
      const missing = Math.max(0, this.accruedTotal() - this.receivedFromClient());
      out.push({
        key: 'prepay',
        tone: 'crit',
        label: this.prepaymentAwaited() ? 'Предоплата не подтверждена' : 'Предоплата не заведена',
        value: this.money(missing),
        valueNote: 'не хватает к начисленному',
        text:
          `Получено ${this.money(this.receivedFromClient())}, начислено ${this.money(this.accruedTotal())} за период. ` +
          'Деньги приходят мимо системы — получение отмечает менеджер.',
        actions: [{ title: 'Открыть начисления', kind: 'primary', act: 'pay' }],
      });
    }

    if (t.partial) {
      out.push({
        key: 'partial',
        tone: 'warn',
        label: 'Собраны не все ссылки',
        value: String(t.partial),
        valueNote: plural(t.partial, 'выкладка', 'выкладки', 'выкладок'),
        text: 'Площадка отмечена, а ссылки нет — просмотры этих роликов в счёт не попадут.',
        actions: [{ title: 'Открыть план', kind: 'quiet', act: 'plan' }],
      });
    }

    if (this.staleLinks().count) {
      const s = this.staleLinks();
      out.push({
        key: 'stale',
        tone: 'warn',
        label: 'Счётчики молчат',
        value: String(s.count),
        valueNote: plural(s.count, 'ссылка', 'ссылки', 'ссылок'),
        text:
          'По ним два дня не было сбора. Это не ноль просмотров, а отсутствие измерения — ' +
          'в счёт такие ролики идут по последнему известному числу.',
        actions: [],
      });
    }

    // Возвращённые ролики. Числом здесь имя, а не количество: пока
    // возврат один — а он обычно один, — менеджеру важно, КОМУ он
    // написал и ждёт ли тот до срока выкладки.
    if (this.returned().length) {
      const list = this.returned();
      const first = list[0];
      out.push({
        key: 'returned',
        tone: 'info',
        label: 'На проверке с нарушением',
        value: list.length === 1 ? first.creator_name || 'Креатор' : String(list.length),
        valueNote: list.length === 1 ? 'ждём пересдачу' : 'роликов возвращено',
        text:
          list.length === 1 && first.review?.comment
            ? `${first.review.comment} Выкладка по плану — ${this.dayLabel(first.due_date)}.`
            : 'Ролики вернули с замечанием: пока их не пересдадут, выкладка не закроется.',
        actions: [{ title: 'Открыть проверку', kind: 'quiet', act: 'review' }],
      });
    }

    if (t.soon) {
      out.push({
        key: 'soon',
        tone: 'warn',
        label: 'Дедлайн на носу',
        value: String(t.soon),
        valueNote: 'сдать в ближайшие 2 дня',
        text: 'Бот напомнит сам, но по этим выкладкам стоит написать лично.',
        actions: [{ title: 'Открыть план', kind: 'quiet', act: 'plan' }],
      });
    }

    return out;
  });

  public readonly reminding = signal(false);

  /**
   * Пинг по всем горящим выкладкам разом.
   *
   * Поимённо их и так видно в плане, но начинают день не с плана:
   * начинают с того, что горит. Ошибку по одной выкладке глотаем —
   * остальные всё равно уходят, а человек увидит итог числом.
   */
  public remindBurning(): void {
    const list = this.burning();
    if (!list.length || this.reminding()) return;
    this.reminding.set(true);
    let done = 0;
    let failed = 0;
    const finish = (): void => {
      if (done + failed < list.length) return;
      this.reminding.set(false);
      if (done)
        this.msg.success(
          `Напомнили: ${done} ${plural(done, 'креатору', 'креаторам', 'креаторам')}`,
        );
      if (failed) this.msg.error(`Не ушло напоминаний: ${failed}`);
    };
    for (const p of list) {
      this.api.managerRemind(p.id).subscribe({
        next: () => {
          done += 1;
          finish();
        },
        error: (e: unknown) => {
          // Уже напоминали сегодня — это не провал: креатор получил
          // напоминание утром, и считать его в «не ушло» неправда.
          if (parseApiError(e, '').code === 'already_reminded') done += 1;
          else failed += 1;
          finish();
        },
      });
    }
  }

  /**
   * Кнопка тревоги ведёт туда, где с ней работают.
   *
   * Экран теперь одна лента, а на телефоне — разделы: переключения
   * вкладки мало, надо ещё и доехать до места. Поэтому здесь и
   * переключение раздела (его видит телефон), и прокрутка к блоку (её
   * видит десктоп). Раньше кнопка звала setTab у вкладок, которых на
   * экране не осталось, и не делала ровно ничего.
   */
  public onAlertAction(act: ManagerAlertAction['act']): void {
    if (act === 'remind') {
      this.remindBurning();
      return;
    }
    const section = act === 'pay' ? 'pay' : act === 'review' ? 'review' : 'plan';
    this.setSection(section);
    this.scrollToSection(section);
  }

  /**
   * Доехать до блока на десктопе.
   *
   * Через requestAnimationFrame: раздел мог быть скрыт тач-слоем, и до
   * следующей отрисовки его высота нулевая — прокрутка уехала бы не
   * туда. `block: 'start'` со сдвигом на липкую полосу пути: без сдвига
   * заголовок блока прячется под ней.
   */
  private scrollToSection(section: string): void {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.sec-${section}`);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }

  /** Дата коротко: «17.09». Текст тревоги собирается в коде, а не в шаблоне. */
  private dayLabel(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  // ═══ кабинет менеджера по макету ══════════════════════════

  public readonly digits = groupDigits;

  public readonly platforms = ALL_PLATFORMS;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly platformLabel = PLATFORM_LABEL;

  /**
   * Открытый раздел НА ТЕЛЕФОНЕ.
   *
   * На десктопе экран идёт одной лентой — тревоги, план, проверка,
   * состав, деньги, — и это в макете так и есть: менеджер проходит их
   * сверху вниз. На телефоне та же лента не прокручивается, поэтому
   * разделы показываются по одному (см. data-sec в тач-слое).
   */
  public readonly section = signal('alerts');

  public setSection(key: string): void {
    this.section.set(key);
  }

  public readonly phoneTabs = computed<SotkaTab[]>(() => [
    { key: 'alerts', title: 'Горит', icon: 'bell', badge: this.alerts().length },
    { key: 'plan', title: 'План', icon: 'cal' },
    { key: 'links', title: 'Ссылки', icon: 'grid' },
    { key: 'review', title: 'Проверка', icon: 'check', badge: this.toReview() },
    { key: 'team', title: 'Команда', icon: 'users' },
    { key: 'pay', title: 'Деньги', icon: 'wallet' },
  ]);

  /** Сколько роликов ждёт проверки — счётчик на вкладке. */
  public readonly toReview = computed(
    () =>
      this.publications().filter(
        (p) => p.links.length > 0 && p.review?.status !== 'accepted' && p.review?.status !== 'returned',
      ).length,
  );

  public readonly nav = computed<SotkaNavItem[]>(() => [
    { title: 'Мои проекты', link: '/manager/projects' },
    { title: this.project().title, link: `/manager/projects/${this.project().id}`, current: true },
  ]);

  public readonly subtitleLine = computed(() => {
    const parts: string[] = [];
    const n = this.crew().length;
    if (n) parts.push(`${n} ${plural(n, 'креатор', 'креатора', 'креаторов')}`);
    const client = this.project().client?.display_name;
    if (client) parts.push(client);
    return parts.join(' · ');
  });

  /** Период проекта: его границы считает сервер, здесь только подпись. */
  public readonly period = signal<BillingPeriod | null>(null);

  public readonly periodLabel = computed(() => {
    const p = this.period();
    return p ? `Период ${p.seq}` : '';
  });

  public readonly periodDay = computed(() => {
    const p = this.period();
    return p ? periodRange(p) : '';
  });

  public readonly periodPercent = computed<number | null>(() => {
    const p = this.period();
    if (!p) return null;
    const a = Date.parse(p.starts_on);
    const b = Date.parse(p.ends_on);
    if (!a || !b || b <= a) return null;
    const now = Date.now();
    if (now <= a) return 0;
    if (now >= b) return 100;
    return Math.round(((now - a) / (b - a)) * 100);
  });

  /** Строка состава: аккаунты, счётчики и состояние по выкладкам. */
  public readonly crewRows = computed(() =>
    this.crew().map((person) => {
      const mine = this.publications().filter(
        (p) => p.creator_user_id === person.user_id && p.status !== 'cancelled',
      );
      return {
        person,
        links: (person.account_links ?? {}) as AccountLinks,
        planned: mine.length,
        done: mine.filter((p) => p.status === 'done' || p.status === 'closed_manually').length,
        late: mine.filter((p) => p.overdue).length,
        review: mine.some((p) => p.links.length && p.review?.status !== 'accepted'),
        views: mine.reduce((s, p) => s + p.views, 0),
        next: [...mine]
          .filter((p) => p.status === 'planned' || p.status === 'partial')
          .sort((a, b) => a.due_date.localeCompare(b.due_date))[0],
      };
    }),
  );

  // ---- статистика креатора в проекте ----
  //
  // Менеджер решает по человеку два вопроса: звать ли его в следующий
  // месяц и почему у него так мало. Оба упираются в цифры, которых на
  // экране не было: в строке стояли «роликов» и «просмотры», то есть
  // сумма — а сумма одинаково выглядит и у ровного исполнителя, и у
  // того, у кого один ролик выстрелил, а остальные девять пустые.

  /** Чья статистика раскрыта. Пусто — ничья. */
  public readonly openCrew = signal<string>('');

  public toggleCrew(userID: string): void {
    this.openCrew.set(this.openCrew() === userID ? '' : userID);
  }

  /**
   * Разбор роликов одного креатора В ЭТОМ ПРОЕКТЕ.
   *
   * Считаем только по измеренным: ролик, вышедший вчера и ещё не
   * собранный, — это не ноль просмотров, а отсутствие измерения.
   * Посчитав его нулём, можно уронить медиану вдвое одной свежей
   * выкладкой и объявить человека слабым на ровном месте.
   */
  public crewStats(userID: string) {
    const measured = this.publications()
      .filter((p) => p.creator_user_id === userID && p.status !== 'cancelled' && p.views > 0)
      .sort((a, b) => (a.published_at ?? a.due_date).localeCompare(b.published_at ?? b.due_date));
    if (!measured.length) return null;

    const byViews = [...measured].sort((a, b) => a.views - b.views);
    const mid = Math.floor(byViews.length / 2);
    // Медиана, а не среднее: один залетевший ролик поднимает среднее
    // вдвое и обещает то, чего обычно не бывает.
    const median =
      byViews.length % 2
        ? byViews[mid].views
        : Math.round((byViews[mid - 1].views + byViews[mid].views) / 2);
    const max = byViews[byViews.length - 1].views;

    return {
      median,
      basis: measured.length,
      best: byViews[byViews.length - 1],
      worst: byViews[0],
      // Столбики в порядке выхода: так видно не только разброс, но и
      // куда он движется. Высота от лучшего — сравнивать надо со своим
      // же потолком, а не с чужим.
      bars: measured.map((p) => ({
        pub: p,
        height: max > 0 ? Math.max(4, Math.round((p.views / max) * 100)) : 4,
        best: p.id === byViews[byViews.length - 1].id,
        worst: byViews.length > 1 && p.id === byViews[0].id,
      })),
    };
  }

  /** Куда ведёт столбик — на сам ролик, а не в пустоту. */
  public pubUrl(p: Publication): string {
    return p.links[0]?.url ?? '';
  }

  /** Пинг одному креатору — по его ближайшей несданной выкладке. */
  public remindCreator(row: { person: ProjectPerson; next?: Publication }): void {
    if (!row.next) {
      this.msg.info(`У ${row.person.display_name} нет несданных выкладок.`);
      return;
    }
    this.api.managerRemind(row.next.id).subscribe({
      next: () => this.msg.success(`Напомнили: ${row.person.display_name}.`),
      error: (e) => {
        const err = parseApiError(e, 'Напоминание не ушло.');
        // 409 already_reminded — бот сегодня уже написал по этой
        // выкладке. Это не отказ, а ответ «уже сделано».
        if (err.code === 'already_reminded') {
          this.msg.info(`Сегодня ${row.person.display_name} уже напоминали — следующее завтра.`);
          return;
        }
        this.msg.error(err.message);
      },
    });
  }

  // ═══ деньги: очередь шагов, начисления, расчёт, журнал ═══
  //
  // Разметка по макету: четыре шага подряд, таблица начислений, плашка
  // расчёта с заказчиком и журнал. Порядок не декоративный — это
  // единственное место, где деньги двигаются руками, и шаги идут строго
  // друг за другом: пересчитали → период подытожился → утвердили →
  // выплатили. Кнопка есть только у следующего шага.

  public readonly accruals = signal<Accrual[]>([]);

  public readonly moneyBusy = signal(false);

  public readonly periodTitleText = computed(() => periodTitle(this.period()));

  /** Строки периода: кто, оклад, ступени, бонус, вычет, итого. */
  public readonly payRows = computed(() =>
    this.accruals().map((a) => ({
      a,
      short: shortfall(a),
      bonus: (a.payout_views_bonus ?? a.views_bonus) + (a.payout_click_bonus ?? a.click_bonus),
      salary: a.payout_salary ?? a.salary,
      deduction: a.payout_deduction ?? a.deduction,
      total: a.payout_total ?? a.total,
    })),
  );

  /** Период ещё идёт — суммы предварительные. */
  public readonly moneyPreview = computed(
    () => isPreviewPeriod(this.accruals()) || this.period()?.status === 'open',
  );

  /**
   * На каком шаге очередь. 0 — пересчитать, 1 — ждём подытога,
   * 2 — утвердить, 3 — выплатить, 4 — всё.
   */
  public readonly payStage = computed(() => {
    const rows = this.accruals();
    if (!rows.length || isPreviewPeriod(rows)) return 0;
    if (this.period()?.status === 'open') return 1;
    if (rows.some((a) => canApprove(a))) return 2;
    if (rows.some((a) => canMarkPaid(a))) return 3;
    return 4;
  });

  public readonly paySteps = computed(() => {
    const stage = this.payStage();
    const affected = recalcAffects(this.accruals());
    return [
      {
        key: 'recalc',
        title: 'Пересчитать',
        note: 'просмотры с площадок',
        action: affected || !this.accruals().length ? 'Пересчитать' : '',
      },
      {
        key: 'lock',
        title: 'Подытожить',
        // Кнопки нет намеренно: период запирается сам через две недели
        // после конца. Ручного подытога в продукте нет, и рисовать
        // кнопку, которой не существует, нельзя.
        note: 'сам, через две недели после конца периода',
        action: '',
      },
      { key: 'approve', title: 'Утвердить', note: 'сумма фиксируется', action: 'Утвердить всех' },
      { key: 'pay', title: 'Выплатить', note: 'отправка на карты', action: 'Отметить выплату' },
    ].map((s, i) => ({
      ...s,
      state: i < stage ? 'done' : i === stage ? 'cur' : '',
      action: i === stage ? s.action : '',
    }));
  });

  /** Рассчитались ли с заказчиком за показанный период. */
  public readonly settled = computed(() => periodSettled(this.period(), this.payments()));

  public onPayStep(key: string): void {
    const id = this.project().id;
    if (this.moneyBusy()) return;
    if (key === 'recalc') {
      this.moneyBusy.set(true);
      this.billingApi.managerRecalcAccruals(id).subscribe({
        next: (r) => {
          this.accruals.set(r.items);
          this.moneyBusy.set(false);
          this.msg.success('Пересчитали по свежим просмотрам.');
          this.load(id);
        },
        error: (e) => {
          this.moneyBusy.set(false);
          this.msg.error(parseApiError(e, 'Не удалось пересчитать.').message);
        },
      });
      return;
    }
    if (key === 'approve' || key === 'pay') {
      const rows = this.accruals().filter((a) => (key === 'approve' ? canApprove(a) : canMarkPaid(a)));
      if (!rows.length) return;
      this.moneyBusy.set(true);
      let left = rows.length;
      for (const a of rows) {
        const req =
          key === 'approve'
            ? this.billingApi.managerApproveAccrual(id, a.id)
            : this.billingApi.managerMarkAccrualPaid(id, a.id);
        req.subscribe({
          next: (saved) => {
            this.accruals.update((list) => list.map((x) => (x.id === saved.id ? saved : x)));
            if (--left === 0) {
              this.moneyBusy.set(false);
              this.msg.success(key === 'approve' ? 'Суммы утверждены.' : 'Выплаты отмечены.');
            }
          },
          error: (e) => {
            if (--left === 0) this.moneyBusy.set(false);
            this.msg.error(parseApiError(e, 'Шаг не прошёл.').message);
          },
        });
      }
    }
  }

  /**
   * Отметить, что с заказчиком рассчитались.
   *
   * Пока отметки нет, у него крупно висит плашка «к оплате». Снимает её
   * не календарь, а этот шаг: деньги приходят мимо системы, и получение
   * подтверждает человек — именем.
   */
  public markSettled(): void {
    const id = this.project().id;
    const kind = this.payments().some((p) => p.kind === 'final') ? 'final' : 'prepayment';
    this.moneyBusy.set(true);
    this.billingApi.managerConfirmPayment(id, kind).subscribe({
      next: () => {
        this.moneyBusy.set(false);
        this.msg.success('Отметили расчёт — плашка у заказчика снята.');
        this.load(id);
      },
      error: (e) => {
        this.moneyBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось отметить расчёт.').message);
      },
    });
  }

  /** Журнал действий по проекту: кто что сделал и когда. */
  public readonly journal = signal<ProjectEvent[]>([]);

  public eventText(e: ProjectEvent): string {
    const who = e.actor_display_name || (e.actor_type === 'system' ? 'система' : 'сотрудник');
    const what: Record<string, string> = {
      created: 'завёл проект',
      assigned: 'сменил ответственного',
      stage_advance: 'двинул стадию',
      step_transition: 'двинул шаг',
      comment: 'написал комментарий',
    };
    return `${who} · ${what[e.event_kind] ?? e.event_kind}`;
  }

  /** План поменялся — перечитываем выкладки. */
  public reload(): void {
    const id = this.project().id;
    this.api.managerList(id).subscribe({
      next: (r) => this.publications.set(r.items),
      error: () => undefined,
    });
  }

  /**
   * Добавить креатора в состав.
   *
   * Раньше на этом месте стояла ссылка на самого себя с ?crew=1 — она
   * никуда не вела и просто подкидывала страницу наверх. Окно поиска
   * людей уже есть и работает в составе проекта по воронке; берём его,
   * а на телефоне открываем шторкой.
   */
  public addCreator(): void {
    const data: AddCreatorDialogData = { projectID: this.project().id };
    const done = (res: unknown): void => {
      if (!res) return;
      this.msg.success('Креатор добавлен в состав.');
      this.load(this.project().id);
    };
    if (this.touch) {
      this.drawer
        .create<AddCreatorDialogComponent, AddCreatorDialogData, unknown>({
          nzTitle: 'Добавить креатора',
          nzContent: AddCreatorDialogComponent,
          nzData: data,
          nzPlacement: 'bottom',
          nzHeight: 'auto',
          nzBodyStyle: { padding: '0 16px 24px' },
        })
        .afterClose.subscribe(done);
      return;
    }
    this.modal
      .create({
        nzTitle: 'Добавить креатора в проект',
        nzContent: AddCreatorDialogComponent,
        nzData: data,
        nzFooter: null,
      })
      .afterClose.subscribe(done);
  }

  public openClientView(): void {
    void this.router.navigate(['/me/projects', this.project().id]);
  }

  /** Имена тех, у кого горит: «у Анастасии и Андрея» читается лучше цифры. */
  public burningNames(): string {
    const names = [
      ...new Set(
        this.burning()
          .map((p) => p.creator_name)
          .filter(Boolean),
      ),
    ];
    return names.join(', ');
  }

  private load(id: string): void {
    this.api.managerCreators(id).subscribe({
      next: (r) => this.crew.set(r.items),
      error: () => this.crew.set([]),
    });
    this.api.managerList(id).subscribe({
      next: (r) => this.publications.set(r.items),
      error: () => this.publications.set([]),
    });
    this.projectApi.managerAssigned().subscribe({
      next: (r) => this.siblings.set(r.items),
      error: () => this.siblings.set([]),
    });
    // Журнал: кто что делал с проектом. В макете он стоит под
    // начислениями — там же, где деньги двигаются руками.
    this.projectApi.managerListEvents(id).subscribe({
      next: (r) => this.journal.set(r.items.slice(-12).reverse()),
      error: () => this.journal.set([]),
    });
    // Платежи проекта, а не месяца: предоплата у проекта одна. Условий у
    // проекта может не быть вовсе — тогда и предупреждать не о чем.
    this.billingApi.managerBilling(id).subscribe({
      next: (r) => {
        this.payments.set(r.payments ?? []);
        this.totals.set(r.totals ?? null);
        this.period.set(r.period ?? null);
        this.accruals.set(r.accruals ?? []);
      },
      error: () => {
        this.payments.set([]);
        this.totals.set(null);
        this.period.set(null);
        this.accruals.set([]);
      },
    });
  }
}
