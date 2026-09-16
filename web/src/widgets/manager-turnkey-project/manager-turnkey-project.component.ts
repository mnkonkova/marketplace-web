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

import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney } from '@entities/billing/lib/money';
import type { PeriodTotals, Payment } from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ProjectPerson, Publication } from '@entities/publication/model/publication.types';
import { ProjectApi } from '@entities/project/api/project.api';
import type { ProjectFullView, ProjectManagerView } from '@entities/project/model/project.types';
import { closedCount, daysLeft } from '@entities/publication/lib/publication-status';
import { plural } from '@shared/lib/format';
import { ZeroComponent } from '@shared/ui/zero/zero.component';
import { ProjectBillingComponent } from '@widgets/project-billing/project-billing.component';
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';
import { ProjectMaterialsComponent } from '@widgets/project-materials/project-materials.component';
import { ProjectPublicationsComponent } from '@widgets/project-publications/project-publications.component';

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
type TabKey = 'plan' | 'crew' | 'talk' | 'stats' | 'pay' | 'mat';

/** Вкладки, которые умеет показывать виджет выкладок. */
type PubSection = 'plan' | 'crew' | 'stats' | 'mat';

@Component({
  selector: 'app-manager-turnkey-project',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ProjectBillingComponent,
    ProjectCommentsComponent,
    ProjectMaterialsComponent,
    ProjectPublicationsComponent,
    ZeroComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-turnkey-project.component.html',
  styleUrls: [
    './manager-turnkey-project.component.scss',
    './manager-turnkey-project.component.touch.scss',
  ],
})
export class ManagerTurnkeyProjectComponent {
  private readonly api = inject(PublicationApi);

  private readonly projectApi = inject(ProjectApi);

  private readonly billingApi = inject(BillingApi);

  private readonly router = inject(Router);

  public readonly project = input.required<ProjectFullView>();

  public readonly meId = input<string>('');

  public readonly tab = signal<TabKey>('plan');

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

  /** Часть виджета выкладок под текущую вкладку. */
  public readonly pubSection = computed<PubSection>(() => {
    const t = this.tab();
    return t === 'crew' || t === 'stats' || t === 'mat' ? t : 'plan';
  });

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

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  public setTab(t: TabKey): void {
    this.tab.set(t);
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
    // Платежи проекта, а не месяца: предоплата у проекта одна. Условий у
    // проекта может не быть вовсе — тогда и предупреждать не о чем.
    this.billingApi.managerBilling(id).subscribe({
      next: (r) => {
        this.payments.set(r.payments ?? []);
        this.totals.set(r.totals ?? null);
      },
      error: () => {
        this.payments.set([]);
        this.totals.set(null);
      },
    });
  }
}
