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

import { ActivatedRoute, Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney } from '@entities/billing/lib/money';
import { canApprove, canMarkPaid, isPreviewPeriod, shortfall } from '@entities/billing/lib/money';
import {
  isOpenPeriod,
  parsePeriodParam,
  periodDay as dayLabelOf,
  periodOptions,
  periodSettled,
  periodTitle,
  snapshotNote,
} from '@entities/billing/lib/period';
import type {
  Accrual,
  BillingTerms,
  PeriodTotals,
  Payment,
} from '@entities/billing/model/billing.types';
import { projectBlocks } from '@entities/publication/lib/project-blocks';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { MonthRequest } from '@entities/publication/model/publication.types';
import type {
  ProjectPerson,
  ProjectSettings,
  Publication,
  PublicationReport,
} from '@entities/publication/model/publication.types';
import { OrderApi } from '@entities/order/api/order.api';
import { CANDIDATE_STATUS_LABEL, candidateTone, freeSlots } from '@entities/order/lib/order-status';
import type { Order, OrderCandidate, OrderResponse } from '@entities/order/model/order.types';
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
  act: 'remind' | 'plan' | 'pay' | 'review' | 'period-end' | 'period-date' | 'month-request';
}

/**
 * Дата без времени: «2026-09-30».
 *
 * Границы периода и сроки выкладок приходят полными отметками времени, и
 * сравнивать их как строки целиком нельзя: у выкладки в тот же день
 * время своё, и «due_date <= ends_on» ложно там, где день тот же.
 */
function day(iso: string): string {
  return iso.slice(0, 10);
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
import { ProjectStatsComponent } from '@widgets/project-stats/project-stats.component';
import { ProjectLinksComponent } from '@widgets/project-links/project-links.component';
import { PublicationPlanComponent } from '@widgets/publication-plan/publication-plan.component';
import { PrMarketAvaComponent } from '@shared/ui/prmarket-ava/prmarket-ava.component';
import {
  PrMarketTopComponent,
  PrMarketNavItem,
} from '@widgets/prmarket-top/prmarket-top.component';
import {
  PrMarketTabbarComponent,
  PrMarketTab,
} from '@widgets/prmarket-tabbar/prmarket-tabbar.component';
import { groupDigits } from '@entities/billing/lib/money';
import { periodRange } from '@entities/billing/lib/period';
import type { BillingPeriod, ProjectPeriod } from '@entities/billing/model/billing.types';
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
    ProjectCommentsComponent,
    ProjectAccountsComponent,
    ProjectChecklistComponent,
    ProjectMaterialsComponent,
    ProjectReviewComponent,
    ProjectAutopingComponent,
    ProjectStatsComponent,
    ProjectLinksComponent,
    PublicationPlanComponent,
    PrMarketAvaComponent,
    PrMarketTopComponent,
    PrMarketTabbarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-turnkey-project.component.html',
  styleUrl: './manager-turnkey-project.component.scss',
})
export class ManagerTurnkeyProjectComponent {
  private readonly api = inject(PublicationApi);

  private readonly projectApi = inject(ProjectApi);

  private readonly orderApi = inject(OrderApi);

  private readonly billingApi = inject(BillingApi);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

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

  /**
   * Заявка заказчика на следующий месяц.
   *
   * Заказчик нажал «Заказать» под прикидкой цены в своём кабинете. Это
   * просьба, а не заказ: цену и состав финализирует менеджер. Плашка
   * гаснет, когда он отметит, что связался.
   */
  public readonly monthRequest = signal<MonthRequest | null>(null);

  public readonly monthBusy = signal(false);

  /** Отметить заявку разобранной: связались и завели заказ (или отказали). */
  public handleMonthRequest(): void {
    if (this.monthBusy()) return;
    this.monthBusy.set(true);
    this.api.managerHandleMonthRequest(this.project().id).subscribe({
      next: () => {
        this.monthBusy.set(false);
        this.monthRequest.set(null);
        this.msg.success('Заявка отмечена разобранной.');
      },
      error: (e) => {
        this.monthBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось отметить заявку.').message);
      },
    });
  }

  /** Состав проекта: он же счётчик на вкладке «Креаторы». */
  public readonly crew = signal<ProjectPerson[]>([]);

  /**
   * Заказ, из которого собрался состав.
   *
   * Состав — результат очереди, а не отдельный список: заказчик прислал
   * ПРИОРИТЕТ, приглашения уходили сверху вниз по одному на свободное
   * место, и человек в проекте потому, что до него дошла очередь. Без
   * этой карточки менеджер видит в составе четвёртого по приоритету и
   * не понимает, почему не первого, — а «кто точно согласен» приходится
   * спрашивать в переписке.
   *
   * Пусто — проект завели руками, заказа не было. Это нормальное
   * состояние, а не сбой: блока просто не будет.
   */
  public readonly order = signal<Order | null>(null);

  public readonly orderBusy = signal(false);

  /**
   * Кого хочет заказчик — и только это.
   *
   * В кандидатах заявки лежат ДВА разных списка. Первый — отмеченные
   * заказчиком: «хочу особенно этих». Второй — все, кому ушла рассылка,
   * а она уходит каждому известному креатору, и это десятки строк,
   * про которые заказчик ничего не говорил. Показать их вперемешку
   * значит утопить ответ на вопрос «кого он хотел» в списке рассылки.
   *
   * Поэтому здесь остаются отмеченные и те, кто уже как-то ответил:
   * отклик, отказ и согласие — это события, про которые менеджеру надо
   * знать. Молчащий получатель рассылки события не создал.
   *
   * Сортируем сами, хотя сервер и отдаёт ORDER BY priority: порядок
   * строк здесь — порядок, в котором заказчик их отмечал, и если он
   * однажды приедет другим, экран должен остаться правым.
   */
  public readonly queue = computed<OrderCandidate[]>(() =>
    (this.order()?.candidates ?? [])
      .filter((c) => c.is_preferred || c.status !== 'reserve')
      .sort((a, b) => a.priority - b.priority),
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
   * Кнопка, которая с этого момента может только получить 409, хуже
   * отсутствующей.
   */
  public readonly canInviteNext = computed(() => {
    const o = this.order();
    if (!o) return false;
    // submitted — заявка из воронки: приглашений ещё не было, и
    // двинуть очередь руками можно ровно как из черновика.
    if (o.status !== 'draft' && o.status !== 'submitted' && o.status !== 'inviting') return false;
    return this.orderFreeSlots() > 0 && o.reserve_left > 0;
  });

  public readonly candidateLabel = CANDIDATE_STATUS_LABEL;

  public candidateTone(status: OrderCandidate['status']): string {
    return candidateTone(status);
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
        if (err.code === 'no_free_slot') this.loadOrder(this.project().id);
        this.msg.error(err.message);
      },
    });
  }

  /**
   * Убрать человека из заявки.
   *
   * Это не то же, что вывести из состава: тут мы отказываемся ЗВАТЬ, а
   * состав не трогаем. Согласившегося сервер и не отдаст — ответит, что
   * выводить надо из состава проекта.
   */
  public dropCandidate(c: OrderCandidate): void {
    const o = this.order();
    if (!o || this.orderBusy()) return;
    this.orderBusy.set(true);
    this.orderApi.managerRemoveCandidate(o.id, c.creator_user_id).subscribe({
      next: (updated) => {
        this.orderBusy.set(false);
        this.order.set(updated);
      },
      error: (e) => {
        this.orderBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось убрать из заявки.').message);
      },
    });
  }

  /** Кого сейчас выводим из состава: по нему же и запирается кнопка. */
  public readonly crewBusy = signal('');

  /**
   * Вывести креатора из состава — мягко.
   *
   * Выкладки, ссылки и цифры человека остаются в проекте и в
   * начислениях: «убрал не того» не должно переписывать историю и
   * ломать уже посчитанные деньги. На сервере это removed_at, а не
   * DELETE.
   */
  public removeCreator(c: ProjectPerson): void {
    if (this.crewBusy()) return;
    this.modal.confirm({
      nzTitle: `Вывести из состава ${c.display_name}?`,
      nzContent:
        'Его выкладки, ссылки и просмотры останутся в проекте и в начислениях — ' +
        'уйдёт только человек. Вернуть можно кнопкой «Добавить креатора».',
      nzOkText: 'Вывести',
      nzOkDanger: true,
      nzOnOk: () => {
        this.crewBusy.set(c.user_id);
        this.api.managerRemoveCreator(this.project().id, c.user_id).subscribe({
          next: () => {
            this.crewBusy.set('');
            this.msg.success('Креатор выведен из состава.');
            this.load(this.project().id);
          },
          error: (e) => {
            this.crewBusy.set('');
            this.msg.error(parseApiError(e, 'Не удалось вывести из состава.').message);
          },
        });
      },
    });
  }

  private loadOrder(id: string): void {
    this.orderApi.managerProjectOrder(id).subscribe({
      next: (o) => {
        this.order.set(o);
        this.loadResponses(o.id);
      },
      error: () => this.order.set(null),
    });
  }

  /**
   * Кто откликнулся на заявку.
   *
   * Это главный экран шага «собрать состав»: приглашение ушло ВСЕМ
   * известным креаторам, и ответили те, кому задача подошла. Очередь
   * приглашений отвечала на другой вопрос — «до кого дошло», — и
   * состав по ней собирался из тех, кто просто был первым в списке.
   */
  public readonly responses = signal<OrderResponse[]>([]);

  private loadResponses(orderID: string): void {
    this.orderApi.orderResponses(orderID).subscribe({
      next: (r) => this.responses.set(r.items ?? []),
      // Молча: блок откликов просто не появится. Состав при этом
      // добавляется кнопкой «Добавить креатора» как раньше.
      error: () => this.responses.set([]),
    });
  }

  /** Кого ещё не взяли в проект: из них и собирают состав. */
  public readonly openResponses = computed(() => this.responses().filter((r) => !r.in_crew));

  /** Кого сейчас берём в проект: по нему же и запирается кнопка. */
  public readonly takingID = signal('');

  public responseLabel(r: OrderResponse): string {
    switch (r.mode) {
      case 'attach':
      case 'upload':
        return 'прислал ролик';
      case 'from_portfolio':
        return 'показал свои ролики';
      default:
        return 'отказался';
    }
  }

  /**
   * Взять откликнувшегося в проект.
   *
   * Через финализацию заявки, а не прямым добавлением в состав: вместе
   * с составом человеку уходит задание проекта — договор, ТЗ и
   * чеклист, — и заявка при этом переходит в «утверждена». Отсюда и
   * предупреждение в шапке блока: материалы должны быть на месте ДО
   * того, как берут первого человека, иначе он не получит ничего и
   * узнает о задании, открыв вкладку.
   */
  public takeIntoProject(r: OrderResponse): void {
    const o = this.order();
    if (!o || this.takingID()) return;
    this.takingID.set(r.creator_user_id);
    this.orderApi.finalizeOrder(o.id, { creator_ids: [r.creator_user_id] }).subscribe({
      next: () => {
        this.takingID.set('');
        this.msg.success(`${r.creator_name || 'Креатор'} в составе — задание ушло ему`);
        // Перечитываем и состав, и заявку: у человека меняется и то и
        // другое, а список откликов должен показать его как взятого.
        this.reloadCrew();
        this.loadOrder(this.project().id);
      },
      error: (e) => {
        this.takingID.set('');
        this.msg.error(parseApiError(e, 'Не удалось взять в проект.').message);
      },
    });
  }

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

  /**
   * Условия проекта — ради одной подписи: фикс считается ЗА РОЛИК, и
   * столбец «Оклад» назвал бы здесь выключенную механику. Старые снимки
   * остались на окладе за период, у них подпись прежняя.
   */
  public readonly terms = signal<BillingTerms | null>(null);

  public readonly salaryCol = computed(() => (this.terms()?.fee_per_video ? 'Фикс' : 'Оклад'));

  /** Начислено креаторам за показанный период — итогом с сервера. */
  public readonly accruedTotal = computed(() => this.totals()?.total ?? 0);

  /** Сколько выкладок закрыто — вторая половина факта в тревоге. */
  public readonly closedCount = computed(() => closedCount(this.livePublications()));

  /** Суммы приходят в копейках: на экран — рублями. */
  public readonly money = formatMoney;

  // ---- стоимость проекта, которую называет менеджер ----
  //
  // У проекта с креаторами сумма складывается из начислений людям, и СПВ
  // считается по ней. Там, где людей нет, складывать нечего: сумму
  // называет менеджер, и она же идёт в делимое СПВ. Хранится она в том
  // же снимке условий, что и ставки, — поэтому и сохраняется той же
  // ручкой, а не своей.

  /** Черновик поля «стоимость», в рублях: копейки в поле ввода не носят. */
  public costDraft = '';

  public readonly costBusy = signal(false);

  /**
   * Что стоит в поле, пока его не трогали.
   *
   * Отдельным computed, а не записью в costDraft из подписки: условия
   * приезжают асинхронно, и присвоение затёрло бы уже начатый ввод.
   *
   * Два источника, и второй не запасной, а основной для этого вида
   * проекта. Условия приезжают из GET /billing, а та ручка у проекта,
   * где ещё не вышло ни одного ролика, отвечает 404 no_periods — и
   * вместе с несуществующим периодом теряет условия, которые от
   * периода не зависят вовсе. Поле стояло пустым при записанной
   * сумме, человек читал это как «не сохранилось», жал «Сохранить»
   * поверх пустого — и сумма стиралась молча, с зелёной плашкой
   * «Стоимость проекта сохранена». СПВ при этом не появлялся никогда.
   *
   * Отчёт отдаёт ту же сумму и от периодов не зависит: он же считает
   * по ней СПВ.
   */
  public readonly costRubles = computed(() => {
    const kop = this.terms()?.project_cost ?? this.report()?.cost ?? 0;
    return kop > 0 ? String(Math.round(kop / 100)) : '';
  });

  public onCost(e: Event): void {
    this.costDraft = (e.target as HTMLInputElement).value;
  }

  /**
   * СПВ — стоимость тысячи просмотров. Считает сервер тем же делением,
   * что и в начислениях: два разных СПВ на одном экране хуже, чем ни
   * одного.
   */
  public readonly costPer1000 = computed(() => this.report()?.cost_per_1000 ?? null);

  /**
   * Сохранить стоимость.
   *
   * Отправляем нулевые ставки рядом с суммой осознанно: ручка условий
   * переписывает снимок целиком, а у проекта без креаторов ставок нет
   * ни одной — оставить их «как было» значило бы хранить тариф, по
   * которому никто ничего не считает.
   */
  public saveCost(): void {
    if (this.costBusy()) return;
    const raw = (this.costDraft || this.costRubles()).replace(/\s/g, '');
    // Пустое поле — не «ноль рублей». Ноль здесь означает «сумму не
    // назвали»: он стирает записанную стоимость и уносит с собой СПВ.
    // Отправлять его по нажатию на «Сохранить» при пустом поле значит
    // терять данные там, где человек ничего не вводил.
    if (!raw) {
      this.msg.error('Впишите сумму: пустое поле стёрло бы записанную стоимость.');
      return;
    }
    const rubles = Number(raw);
    if (!Number.isFinite(rubles) || rubles < 0) {
      this.msg.error('Стоимость — число в рублях, не меньше нуля.');
      return;
    }
    this.costBusy.set(true);
    this.billingApi
      .managerSaveTerms(this.project().id, {
        project_cost: Math.round(rubles * 100),
        salary_per_month: 0,
        rate_per_1000_views: 0,
        rate_per_1000_views_over: 0,
        bonus_views_threshold: 0,
      })
      .subscribe({
        next: (t) => {
          this.costBusy.set(false);
          this.terms.set(t);
          this.costDraft = '';
          // Отчёт перечитываем: СПВ считается из этой суммы, и без
          // перечитывания рядом со свежей стоимостью стоял бы старый СПВ.
          this.api.managerReport(this.project().id).subscribe({
            next: (r) => this.report.set(r),
            error: () => this.report.set(null),
          });
          this.msg.success('Стоимость проекта сохранена.');
        },
        error: (e) => {
          this.costBusy.set(false);
          this.msg.error(parseApiError(e, 'Не удалось сохранить стоимость.').message);
        },
      });
  }

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
    // Номер периода из адреса — ссылкой на подытоженный период делятся в
    // переписке, и открыться она обязана тем же периодом. Читаем ДО
    // загрузки: иначе первый запрос уйдёт за текущим и перекроет ответ.
    this.selectedSeq.set(parsePeriodParam(this.route.snapshot.queryParamMap.get('period')));
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

  /**
   * Конец периода ждёт подтверждения.
   *
   * Границу считает автомат — месяц от первой выкладки, — и он остаётся
   * главным путём. Но ПОСЛЕДНЮЮ выкладку периода ставит человек, и она
   * может стоять не в тот день, в который месяц кончается по
   * арифметике. Поэтому спрашиваем: подтверждённая дата сильнее
   * вычисленной.
   *
   * Спрашиваем, только когда план уже проставлен и период ещё идёт: у
   * периода без единой выкладки подтверждать нечего, а у подытоженного
   * поздно — под ним стоит счёт.
   */
  public readonly periodEndAsk = computed(() => {
    const p = this.period();
    if (!p || p.status !== 'open') return null;
    if ('ends_on_confirmed_at' in p && p.ends_on_confirmed_at) return null;
    const from = day(p.starts_on);
    const to = day(p.ends_on);
    const inside = this.publications()
      .filter((x) => x.status !== 'cancelled')
      .map((x) => day(x.due_date))
      .filter((d) => d >= from && d <= to)
      .sort();
    if (!inside.length) return null;
    return { seq: p.seq, endsOn: to, last: inside[inside.length - 1] };
  });

  /** Открыт ли ввод другой даты конца периода. */
  public readonly periodDateOpen = signal(false);

  public periodDateDraft = '';

  public readonly periodBusy = signal(false);

  /**
   * Подтвердить конец периода.
   *
   * Без даты — отметка «проверил»: тревога гаснет, границы не
   * двигаются. С датой — граница переезжает, и вместе с ней вся цепочка
   * дальше, поэтому после ответа перечитываем проект целиком: номера и
   * границы периодов могли стать другими.
   */
  public confirmPeriodEnd(endsOn?: string): void {
    const ask = this.periodEndAsk();
    if (!ask || this.periodBusy()) return;
    this.periodBusy.set(true);
    this.billingApi.managerConfirmPeriodEnd(this.project().id, ask.seq, endsOn).subscribe({
      next: () => {
        this.periodBusy.set(false);
        this.periodDateOpen.set(false);
        this.msg.success(
          endsOn && endsOn !== ask.endsOn
            ? 'Граница периода переехала. Следующие выкладки пойдут в следующий период.'
            : 'Конец периода подтверждён.',
        );
        this.load(this.project().id);
      },
      error: (e) => {
        this.periodBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось подтвердить конец периода.').message);
      },
    });
  }

  public onPeriodDate(e: Event): void {
    this.periodDateDraft = (e.target as HTMLInputElement).value;
  }

  public readonly alerts = computed<ManagerAlert[]>(() => {
    const out: ManagerAlert[] = [];
    const t = this.today();
    // Тревога про то, чего у вида нет, — не «пустая строка», а ложная:
    // она обещает действие, которого на экране не будет.
    const b = this.blocks();

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

    // Заявка заказчика на следующий месяц. Стоит рядом с деньгами и
    // выше мелких тревог: человек ЖДЁТ ответа, и молчание здесь стоит
    // дороже любой недосданной ссылки — он просто уйдёт к другим.
    const monthAsk = this.monthRequest();
    if (monthAsk) {
      const mr = monthAsk;
      out.push({
        key: 'month-request',
        tone: 'warn',
        label: 'Заказчик просит следующий месяц',
        value: this.money(mr.ceiling),
        valueNote: 'потолок, который он видел',
        text:
          `Роликов: ${mr.videos}, креаторов: ${mr.creators}. ` +
          'Это просьба, а не заказ: цену и состав финализируете вы.',
        actions: [{ title: 'Связались, разобрал', kind: 'primary', act: 'month-request' }],
      });
    }

    if (b.billing && this.prepaymentRisk()) {
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

    // Подтверждение конца периода. Стоит выше мелких тревог: от этой
    // даты считается вся цепочка дальше — отсечка, доплата по прайсу и
    // то, в какой период попадут следующие выкладки.
    if (b.billing && this.periodEndAsk()) {
      const ask = this.periodEndAsk()!;
      const same = ask.last === ask.endsOn;
      out.push({
        key: 'period-end',
        tone: 'warn',
        label: `Подтвердите конец периода ${ask.seq}`,
        value: this.dayLabel(ask.endsOn),
        valueNote: 'по расчёту',
        text: same
          ? 'Последняя выкладка периода стоит ровно на этой дате. Подтвердите — и следующие ' +
            'выкладки пойдут в следующий период.'
          : `Последняя выкладка периода стоит ${this.dayLabel(ask.last)}. Период можно закончить ею — ` +
            'подтверждённая дата сильнее расчётной.',
        actions: [
          { title: `Подтвердить ${this.dayLabel(ask.endsOn)}`, kind: 'primary', act: 'period-end' },
          { title: 'Другая дата', kind: 'quiet', act: 'period-date' },
        ],
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
    if (b.review && this.returned().length) {
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
    if (act === 'month-request') {
      this.handleMonthRequest();
      return;
    }
    if (act === 'period-end') {
      this.confirmPeriodEnd();
      return;
    }
    if (act === 'period-date') {
      // Подставляем последнюю выкладку периода: ради неё подтверждение и
      // существует, и чаще всего именно ею период и кончается.
      this.periodDateDraft = this.periodEndAsk()?.last ?? '';
      this.periodDateOpen.set(!this.periodDateOpen());
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
   * Что у этого вида проекта вообще есть.
   *
   * До сих пор карточка менеджера карту блоков не спрашивала вовсе: её
   * секции ничем не выключались, а нужный виджет выбирался проверкой
   * вида на уровне страницы. С появлением второго вида с планом
   * выкладок это означало бы второй почти такой же виджет — и две
   * копии одной вёрстки, расходящиеся с первой правки.
   *
   * statsAllowed: true — настройка «показывать статистику» касается
   * заказчика, а не менеджера: он видит цифры всегда.
   */
  public readonly blocks = computed(() =>
    projectBlocks('manager', { kind: this.project().kind, statsAllowed: true }),
  );

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

  /**
   * Нижняя полоса на телефоне — из карты блоков, а не из литерала.
   *
   * Разделы прячет тач-слой по data-sec, и вкладка на раздел, которого у
   * вида нет, открывала бы пустой экран. Виноватым при этом выглядел бы
   * не список вкладок, а вёрстка.
   */
  public readonly phoneTabs = computed<PrMarketTab[]>(() => {
    const b = this.blocks();
    const tabs: PrMarketTab[] = [
      { key: 'alerts', title: 'Горит', icon: 'bell', badge: this.alerts().length },
    ];
    if (b.publications) {
      tabs.push({ key: 'plan', title: 'План', icon: 'cal' });
      tabs.push({ key: 'links', title: 'Ссылки', icon: 'grid' });
    }
    if (b.review) {
      tabs.push({ key: 'review', title: 'Проверка', icon: 'check', badge: this.toReview() });
    }
    if (b.roster || b.accounts) {
      // Название по содержимому: там, где состава нет, «Команда» ведёт
      // на список аккаунтов и читается как потерянный раздел.
      tabs.push({
        key: 'team',
        title: b.roster ? 'Команда' : 'Аккаунты',
        icon: b.roster ? 'users' : 'grid',
      });
    }
    if (b.billing || b.cost) {
      tabs.push({ key: 'pay', title: 'Деньги', icon: 'wallet' });
    }
    return tabs;
  });

  /** Сколько роликов ждёт проверки — счётчик на вкладке. */
  public readonly toReview = computed(
    () =>
      this.publications().filter(
        (p) =>
          p.links.length > 0 && p.review?.status !== 'accepted' && p.review?.status !== 'returned',
      ).length,
  );

  public readonly nav = computed<PrMarketNavItem[]>(() => [
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

  /**
   * Периоды проекта списком — ради выбора, какой смотреть.
   *
   * Выпадашка не украшение: счёт выставляют за ПРОШЛЫЙ период, и без
   * неё менеджер отвечает на «сколько мы выставили в сентябре» из
   * головы. Список — это именно периоды, а не двенадцать календарных
   * месяцев, про которые никто не знает, есть ли там что-нибудь.
   */
  public readonly periods = signal<ProjectPeriod[]>([]);

  /** Какой период показан: null — текущий. Едет в адрес, чтобы ссылкой делились. */
  public readonly selectedSeq = signal<number | null>(null);

  public readonly periodChoices = computed(() => periodOptions(this.periods()));

  public periodLabel2(p: ProjectPeriod): string {
    return periodTitle(p) + (p.status === 'locked' ? ' · подытожен' : '');
  }

  /**
   * Две пометки, и схлопывать их в одну нельзя. «Предварительно» значит
   * «подожди, числа ещё изменятся». «Приблизительно» — «период уже
   * подытожен, но мерить было нечем». Бывают порознь и означают разное.
   */
  public readonly preliminary = computed(() => isOpenPeriod(this.period()));

  public readonly approximate = computed(() => !!this.period()?.snapshot_approx);

  public readonly snapshotNote = computed(() => snapshotNote(this.period()));

  /** Докуда идёт показанный период — в пометке «суммы ещё изменятся». */
  public readonly periodEndDay = computed(() => {
    const p = this.period();
    return p ? dayLabelOf(p.ends_on) : '';
  });

  private readonly isAdmin = inject(AuthSessionStore).isAdmin;

  /**
   * Переоткрыть подытоженный период может ОДИН АДМИН.
   *
   * Действие менеджерское по месту, но не по праву: счёт уже выставлен,
   * заказчик его видел, и отменять решение автоматики походя нельзя.
   * Кнопка, которая ответит отказом, хуже отсутствующей.
   */
  public readonly canUnlock = computed(() => this.isAdmin() && this.period()?.status === 'locked');

  public unlockPeriod(): void {
    const p = this.period();
    if (!p) return;
    this.modal.confirm({
      nzTitle: `Переоткрыть период ${p.seq}?`,
      nzContent:
        'Срез просмотров снимется заново, суммы пересчитаются по сегодняшним цифрам. Счёт, ' +
        'который заказчик уже видел, изменится.',
      nzOnOk: () => {
        this.moneyBusy.set(true);
        this.billingApi.adminUnlockPeriod(this.project().id, p.seq).subscribe({
          next: () => {
            this.moneyBusy.set(false);
            this.msg.success('Период переоткрыт');
            this.load(this.project().id);
          },
          error: (e) => {
            this.moneyBusy.set(false);
            this.msg.error(parseApiError(e, 'Не удалось переоткрыть период.').message);
          },
        });
      },
    });
  }

  public setPeriod(seq: number | string): void {
    const n = Number(seq);
    const id = this.project().id;
    this.selectedSeq.set(Number.isFinite(n) && n > 0 ? n : null);
    // Номер периода едет в адрес: ссылкой на подытоженный период
    // делятся в переписке, и открыться она обязана тем же периодом.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { period: this.selectedSeq() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.loadMoney(id);
  }

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
    const spread = max > byViews[0].views;

    return {
      median,
      basis: measured.length,
      best: byViews[byViews.length - 1],
      worst: byViews[0],
      // Есть ли вообще разброс. Когда все ролики набрали поровну,
      // «лучший» и «слабее всех» — одно и то же число, а подсветка
      // столбиков назначает кого-то худшим по порядку в списке. Это не
      // разбор, а выдумка: сказать «разброса нет» честнее.
      spread: byViews[byViews.length - 1].views > byViews[0].views,
      // Столбики в порядке выхода: так видно не только разброс, но и
      // куда он движется. Высота от лучшего — сравнивать надо со своим
      // же потолком, а не с чужим.
      bars: measured.map((p) => ({
        pub: p,
        height: max > 0 ? Math.max(4, Math.round((p.views / max) * 100)) : 4,
        best: spread && p.id === byViews[byViews.length - 1].id,
        worst: spread && p.id === byViews[0].id,
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
    return [
      {
        key: 'recalc',
        title: 'Пересчитать',
        note: 'просмотры с площадок',
        action: 'Пересчитать',
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
      // Кнопка — у следующего шага. Исключение одно: пересчёт доступен,
      // пока период не подытожен. Просмотры приходят каждый день, и
      // менеджер тянет их посреди периода, а не один раз в начале;
      // кнопка, пропавшая после первого нажатия, читается как поломка.
      action: s.key === 'recalc' ? (stage <= 1 ? s.action : '') : i === stage ? s.action : '',
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
      const rows = this.accruals().filter((a) =>
        key === 'approve' ? canApprove(a) : canMarkPaid(a),
      );
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

  /**
   * Цифры проекта: просмотры, прирост, разбивка по площадкам.
   *
   * Менеджеру они нужны там же, где всё остальное про проект: он
   * отвечает заказчику на «сколько набрали» и решает, кого звать в
   * следующий месяц. Ссылка «статистика глазами заказчика» на этот
   * вопрос не отвечает — она уводит с экрана.
   */
  public readonly report = signal<PublicationReport | null>(null);

  /**
   * Этап согласования черновика — настройка ПРОЕКТА, а не выкладки: у
   * всех выкладок он один.
   *
   * Включено — у выкладки два срока: сдать черновик и выложить, и бот
   * пингует по первому. Выключение не стирает уже проставленные сроки:
   * по ним креатор уже сдаёт, и отменять договорённость задним числом
   * нельзя — новые выкладки просто заводятся с одним сроком.
   */
  public readonly settings = signal<ProjectSettings | null>(null);

  // Тумблера этой настройки на странице больше нет: решение принимают в
  // момент простановки дат, там его и спрашивают — в окне «Проставить
  // пачкой», где рядом видно, на какие дни встанут сроки. Сама настройка
  // остаётся здесь, потому что окно берёт из неё начальное состояние.

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

  /** Перечитать состав: он меняется и руками, и финализацией заявки. */
  private reloadCrew(): void {
    this.api.managerCreators(this.project().id).subscribe({
      next: (r) => this.crew.set(r.items),
      error: () => this.crew.set([]),
    });
  }

  private load(id: string): void {
    this.loadOrder(id);
    this.api.managerMonthRequest(id).subscribe({
      next: (r) => this.monthRequest.set(r.request),
      error: () => this.monthRequest.set(null),
    });
    this.reloadCrew();
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
    this.api.managerProjectSettings(id).subscribe({
      next: (r) => this.settings.set(r),
      error: () => this.settings.set(null),
    });
    this.api.managerReport(id).subscribe({
      next: (r) => this.report.set(r),
      error: () => this.report.set(null),
    });
    // Список периодов — для выпадашки. Пустой список у проекта без
    // выкладок это не ошибка: периода ещё нет, и выбирать не из чего.
    this.billingApi.managerPeriods(id).subscribe({
      next: (r) => this.periods.set(r.items ?? []),
      error: () => this.periods.set([]),
    });
    this.loadMoney(id);
  }

  /**
   * Деньги показанного периода.
   *
   * Отдельно от load: выпадашка периодов перечитывает только их, а не
   * весь проект — состав, план и журнал от смены периода не меняются.
   */
  private loadMoney(id: string): void {
    // Платежи проекта, а не месяца: предоплата у проекта одна. Условий у
    // проекта может не быть вовсе — тогда и предупреждать не о чем.
    this.billingApi.managerBilling(id, this.selectedSeq() ?? undefined).subscribe({
      next: (r) => {
        this.payments.set(r.payments ?? []);
        this.terms.set(r.terms ?? null);
        this.totals.set(r.totals ?? null);
        this.period.set(r.period ?? null);
        this.accruals.set(r.accruals ?? []);
      },
      error: () => {
        this.payments.set([]);
        this.terms.set(null);
        this.totals.set(null);
        this.period.set(null);
        this.accruals.set([]);
      },
    });
  }
}
