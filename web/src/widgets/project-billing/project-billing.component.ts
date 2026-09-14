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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { BillingApi } from '@entities/billing/api/billing.api';
import {
  Accrual,
  Payment,
  PaymentKind,
  PeriodTotals,
  ProjectBilling,
  ProjectPeriod,
  UtmLink,
} from '@entities/billing/model/billing.types';
import {
  ACCRUAL_STATUS_COLOR,
  ACCRUAL_STATUS_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_KIND_MISSING,
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_LABEL,
  bonusTotal,
  canApprove,
  canConfirmPayment,
  canEditPayment,
  canMarkPaid,
  clickTiers,
  clicksEnabled,
  formatMoney,
  fromRubles,
  isPreviewPeriod,
  recalcAffects,
  isFromOrder,
  salaryScopeTiers,
  teamOrder,
  shortfall,
  toRubles,
  viewsTiers,
} from '@entities/billing/lib/money';
import {
  isOpenPeriod,
  parsePeriodParam,
  periodOptions,
  periodRange,
  periodTitle,
  snapshotNote,
} from '@entities/billing/lib/period';
import { creatorLabel } from '@entities/publication/lib/publication-status';
import { parseApiError } from '@shared/api/api-error';
import { plural } from '@shared/lib/format';

export type BillingRole = 'manager' | 'client';

/** Строка выпадашки периодов. */
export interface PeriodChoice {
  seq: number;
  label: string;
}

// Деньги проекта. Заказчик видит условия, платежи, итог периода и
// «Команду периода» — кто сколько сдал и во сколько это ему обошлось: он
// за неё платит, и «60 000 + 5 850» это его счёт. Менеджер вдобавок
// пересчитывает, утверждает, отмечает выплату и ставит UTM-метки —
// меток заказчику бэк не отдаёт, это инструмент менеджера.
//
// Период — не календарный месяц: он начинается датой первой публикации
// проекта и катится от неё. Поэтому выбирается он номером (?period=N), а
// подписывается датами, и список периодов приходит с сервера, а не
// строится из последних двенадцати месяцев: тот список показывал месяцы,
// про которые никто не знал, есть ли там хоть что-нибудь.
//
// Все суммы в копейках. В рубли переводим только на экране, а в полях
// ввода наоборот: менеджер пишет рубли, мы умножаем на 100.
@Component({
  selector: 'app-project-billing',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, NzInputModule, NzTagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-billing.component.html',
  styleUrl: './project-billing.component.scss',
})
export class ProjectBillingComponent {
  private readonly api = inject(BillingApi);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  // Переоткрыть подытоженный период может только админ: это правка уже
  // выставленного счёта, а не рядовое действие менеджера.
  private readonly isAdmin = inject(AuthSessionStore).isAdmin;

  public readonly projectId = input.required<string>();

  public readonly role = input.required<BillingRole>();

  public readonly statusLabel = ACCRUAL_STATUS_LABEL;

  public readonly statusColor = ACCRUAL_STATUS_COLOR;

  public readonly paymentLabel = PAYMENT_KIND_LABEL;

  public readonly paymentMissing = PAYMENT_KIND_MISSING;

  public readonly payStatusLabel = PAYMENT_STATUS_LABEL;

  public readonly payStatusColor = PAYMENT_STATUS_COLOR;

  public readonly paymentKinds: readonly PaymentKind[] = ['prepayment', 'final'];

  public readonly billing = signal<ProjectBilling | null>(null);

  /**
   * Какой период показываем. null — текущий.
   *
   * Начальное значение читаем из адреса: ссылку на конкретный период
   * пересылают в чате, и открываться она должна на нём, а не на
   * сегодняшнем.
   */
  public readonly period = signal<number | null>(
    parsePeriodParam(this.route.snapshot.queryParamMap.get('period')),
  );

  /** Периоды проекта с сервера. Только у менеджера — ручка его. */
  public readonly periods = signal<ProjectPeriod[]>([]);

  /**
   * У проекта ещё нет периодов: не вышло ни одного ролика.
   *
   * Это состояние, а не сбой: отсчёт начинается с первой публикации, и
   * до неё считать не от чего. Показывать здесь ноль было бы неправдой —
   * ноль значит «посчитали и вышло ноль».
   */
  public readonly noPeriods = signal(false);

  public readonly busy = signal<string | null>(null);

  /**
   * Сколько всего периодов у проекта.
   *
   * Нужно заказчику: ручки со списком периодов у него нет — это
   * инструмент менеджера. Зато номер текущего периода приходит в ответе,
   * а периоды нумеруются подряд, так что периоды с первого по текущий
   * заведомо существуют. Запоминаем номер с первой загрузки, пока она
   * идёт за текущим периодом.
   */
  private readonly topSeq = signal(0);

  public constructor() {
    effect(() => {
      const id = this.projectId();
      const role = this.role();
      // Период читаем как зависимость: его смена перечитывает начисления.
      const period = this.period();
      if (id) this.load(id, role, period);
    });
    effect(() => {
      const id = this.projectId();
      if (id && this.role() === 'manager') this.loadPeriods(id);
    });
  }

  public readonly isManager = computed(() => this.role() === 'manager');

  public readonly terms = computed(() => this.billing()?.terms ?? null);

  public readonly payments = computed(() => this.billing()?.payments ?? []);

  public readonly accruals = computed(() => this.billing()?.accruals ?? []);

  public readonly utm = computed(() => this.billing()?.utm ?? []);

  public readonly totals = computed<PeriodTotals | null>(() => this.billing()?.totals ?? null);

  /** Показанный период целиком: состояние, границы, срез. */
  public readonly shown = computed(() => this.billing()?.period ?? null);

  // Блок вообще есть, если у проекта заведены условия или платежи. Пустой
  // «К оплате» на проекте без тарифа — шум. Проект без периодов тоже
  // показываем: там вместо чисел стоит объяснение, почему их нет.
  public readonly hasAnything = computed(
    () =>
      this.noPeriods() ||
      !!this.terms() ||
      this.payments().length > 0 ||
      this.accruals().length > 0,
  );

  /** «Период 2 · 15 сентября — 14 октября». */
  public readonly periodTitle = computed(() => periodTitle(this.shown()));

  /** «15 сентября — 14 октября» — когда номер уже стоит рядом. */
  public readonly periodRange = computed(() => {
    const p = this.shown();
    return p ? periodRange(p) : '';
  });

  /** Период ещё идёт — числа изменятся. Отдельно от «приблизительных». */
  public readonly preliminary = computed(() => isOpenPeriod(this.shown()));

  /**
   * Числа подтянуты, а не измерены: поденной статистики за период уже
   * нет. Отдельная плашка, а не оттенок «предварительно»: первое значит
   * «подожди, ещё изменится», второе — «перепроверь, мерить было нечем».
   */
  public readonly approximate = computed(() => !!this.shown()?.snapshot_approx);

  /** «по состоянию на 14 октября» — рядом с числами подытоженного периода. */
  public readonly snapshotNote = computed(() => snapshotNote(this.shown()));

  /** Подытоженный период переоткрывает только админ. */
  public readonly canUnlock = computed(
    () => this.isManager() && this.isAdmin() && this.shown()?.status === 'locked',
  );

  /**
   * Выпадашка периодов.
   *
   * У менеджера — настоящий список с сервера, с датами и состоянием. У
   * заказчика ручки со списком нет, поэтому номера: какие периоды
   * существуют, видно по номеру текущего, а вот их границы придумывать
   * нельзя — правило периода живёт на сервере. Даты выбранного периода
   * он видит в заголовке под выпадашкой.
   */
  public readonly choices = computed<PeriodChoice[]>(() => {
    if (this.isManager()) {
      return periodOptions(this.periods()).map((p) => ({
        seq: p.seq,
        label: `Период ${p.seq} · ${periodRange(p)}${p.status === 'open' ? ' · идёт' : ''}`,
      }));
    }
    const top = this.topSeq();
    const out: PeriodChoice[] = [];
    for (let seq = top; seq >= 1; seq -= 1) out.push({ seq, label: `Период ${seq}` });
    return out;
  });

  /** Что выбрано в выпадашке: null — текущий, и его номер знает ответ. */
  public readonly selectedSeq = computed(() => this.period() ?? this.shown()?.seq ?? null);

  public readonly viewsRates = computed(() => {
    const t = this.terms();
    return t ? viewsTiers(t) : [];
  });

  public readonly clickRates = computed(() => {
    const t = this.terms();
    return t ? clickTiers(t) : [];
  });

  public readonly clicksOff = computed(() => {
    const t = this.terms();
    return !!t && !clicksEnabled(t);
  });

  // За какой объём назван оклад. Пусто, если в тарифе объём не задан —
  // выдумывать «30 видео» нельзя.
  public readonly salaryScope = computed(() => {
    const t = this.terms();
    return t ? salaryScopeTiers(t) : [];
  });

  // «Команда периода» у заказчика: кто сколько сдал и во сколько обошёлся.
  public readonly team = computed(() => teamOrder(this.accruals()));

  public readonly fromOrder = computed(() => isFromOrder(this.accruals()));

  // Пересчёт трогает только черновики: утверждённое и выплаченное он не
  // меняет. Если черновиков нет, кнопка ничего не сделает.
  public readonly draftsCount = computed(() => recalcAffects(this.accruals()));

  /** Период показан расчётом: строк в базе ещё нет. */
  public readonly previewPeriod = computed(() => isPreviewPeriod(this.accruals()));

  /**
   * Оклад один или их несколько.
   *
   * «Оклады за период» при одном креаторе в составе — не обобщение, а
   * ошибка согласования: читатель ищет глазами вторую строку, которой нет.
   */
  public readonly salaryTitle = computed(() => (this.accruals().length === 1 ? 'Оклад' : 'Оклады'));

  public money(v: number | null | undefined): string {
    return formatMoney(v);
  }

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  public who(a: Accrual | UtmLink): string {
    return creatorLabel(a.creator_name);
  }

  public missing(a: Accrual): number {
    return shortfall(a);
  }

  public approvable(a: Accrual): boolean {
    return canApprove(a);
  }

  public payable(a: Accrual): boolean {
    return canMarkPaid(a);
  }

  public paymentOf(kind: PaymentKind): Payment | undefined {
    return this.payments().find((p) => p.kind === kind);
  }

  public editablePayment(p?: Payment): boolean {
    return canEditPayment(p);
  }

  public confirmablePayment(p?: Payment): boolean {
    return canConfirmPayment(p);
  }

  // Второе слагаемое в «60 000 + 5 850».
  public bonusOf(a: Accrual): number {
    return bonusTotal(a);
  }

  /**
   * Выбор периода.
   *
   * Номер уходит и в адрес: ссылку на разбирательство по конкретному
   * периоду пересылают в чате, и она должна открываться на нём.
   */
  public setPeriod(value: string): void {
    const seq = parsePeriodParam(value);
    this.period.set(seq);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { period: seq },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- условия (менеджер) ----
  //
  // Полей ставок здесь больше нет: тариф проекта снимается с прайса
  // площадки, под которым стоит согласие заказчика. Ручная правка внутри
  // проекта расходилась с тем, на что клиент соглашался, — и по этой
  // разнице спорить было нечем.

  public adoptTerms(): void {
    this.busy.set('terms');
    this.api.managerAdoptTerms(this.projectId()).subscribe({
      next: (saved) => {
        this.busy.set(null);
        this.patch({ terms: saved });
        this.msg.success('Условия взяты из действующего прайса');
      },
      error: (e) => {
        this.busy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось взять условия из прайса.').message);
      },
    });
  }

  // ---- платежи (менеджер) ----

  public readonly editingPayment = signal<PaymentKind | null>(null);

  public paymentRub = '';

  public paymentNote = '';

  public openPayment(kind: PaymentKind): void {
    const p = this.paymentOf(kind);
    this.paymentRub = p ? String(toRubles(p.amount)) : '';
    this.paymentNote = p?.note ?? '';
    this.editingPayment.set(kind);
  }

  public cancelPayment(): void {
    this.editingPayment.set(null);
  }

  public savePayment(): void {
    const kind = this.editingPayment();
    if (!kind) return;
    const amount = Number(this.paymentRub);
    if (Number.isNaN(amount) || amount < 0) {
      this.msg.error('Сумма — неотрицательное число в рублях.');
      return;
    }
    this.busy.set(`pay:${kind}`);
    this.api
      .managerSavePayment(this.projectId(), kind, {
        amount: fromRubles(amount),
        note: this.paymentNote.trim() || undefined,
      })
      .subscribe({
        next: (saved) => {
          this.busy.set(null);
          this.editingPayment.set(null);
          this.replacePayment(saved);
        },
        error: (e) => {
          this.busy.set(null);
          const err = parseApiError(e, 'Не удалось сохранить платёж.');
          // 409 — платёж подтверждён, суммy задним числом не меняем.
          if (err.code === 'already_confirmed') {
            this.editingPayment.set(null);
            this.reload();
          }
          this.msg.error(err.message);
        },
      });
  }

  // Платёжного провайдера нет: деньги приходят мимо системы, менеджер
  // подтверждает получение, и подтверждение именное.
  public confirmPayment(kind: PaymentKind): void {
    this.modal.confirm({
      nzTitle: `Подтвердить ${this.paymentLabel[kind].toLowerCase()}?`,
      nzContent:
        'Подтверждение именное и заносится в журнал. Сумму подтверждённого платежа задним ' +
        'числом изменить нельзя.',
      nzOnOk: () => {
        this.busy.set(`pay:${kind}`);
        this.api.managerConfirmPayment(this.projectId(), kind).subscribe({
          next: (saved) => {
            this.busy.set(null);
            this.replacePayment(saved);
            this.msg.success('Платёж отмечен полученным');
          },
          error: (e) => {
            this.busy.set(null);
            const err = parseApiError(e, 'Не удалось подтвердить платёж.');
            if (err.code === 'already_confirmed') this.reload();
            this.msg.error(err.message);
          },
        });
      },
    });
  }

  // ---- начисления (менеджер) ----

  public recalc(): void {
    this.busy.set('recalc');
    this.api.managerRecalcAccruals(this.projectId(), this.period() ?? undefined).subscribe({
      next: (r) => {
        this.busy.set(null);
        this.msg.success(
          `Пересчитано: ${r.items.length} ${plural(r.items.length, 'строка', 'строки', 'строк')}`,
        );
        this.reload();
      },
      error: (e) => {
        this.busy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось пересчитать.').message);
      },
    });
  }

  public approve(a: Accrual): void {
    this.modal.confirm({
      nzTitle: `Утвердить период у «${this.who(a)}»?`,
      nzContent:
        'После утверждения строка не пересчитывается: просмотры, доехавшие позже, уйдут ' +
        'в следующий период.',
      nzOnOk: () => this.act(a, 'approve'),
    });
  }

  public markPaid(a: Accrual): void {
    this.act(a, 'paid');
  }

  /**
   * Переоткрыть подытоженный период.
   *
   * Подытоживает только автоматика — руками период больше не закрывают.
   * Обратное действие оставлено админу: это правка уже выставленного
   * счёта, и делать её походя нельзя.
   */
  public unlockPeriod(): void {
    const p = this.shown();
    if (!p) return;
    this.modal.confirm({
      nzTitle: `Переоткрыть период ${p.seq}?`,
      nzContent:
        'Срез просмотров снимется заново, суммы пересчитаются по сегодняшним цифрам. Счёт, ' +
        'который заказчик уже видел, изменится.',
      nzOnOk: () => {
        this.busy.set('unlock');
        this.api.adminUnlockPeriod(this.projectId(), p.seq).subscribe({
          next: () => {
            this.busy.set(null);
            this.msg.success('Период переоткрыт');
            this.reload();
          },
          error: (e) => {
            this.busy.set(null);
            this.msg.error(parseApiError(e, 'Не удалось переоткрыть период.').message);
          },
        });
      },
    });
  }

  private act(a: Accrual, what: 'approve' | 'paid'): void {
    this.busy.set(a.id);
    const req =
      what === 'approve'
        ? this.api.managerApproveAccrual(this.projectId(), a.id)
        : this.api.managerMarkAccrualPaid(this.projectId(), a.id);
    req.subscribe({
      next: (saved) => {
        this.busy.set(null);
        this.patch({
          accruals: this.accruals().map((x) => (x.id === saved.id ? saved : x)),
        });
        this.msg.success(what === 'approve' ? 'Период утверждён' : 'Отмечено как выплаченное');
        // Итог периода считает сервер — перечитываем, а не складываем сами.
        this.reload();
      },
      error: (e) => {
        this.busy.set(null);
        const err = parseApiError(e, 'Не удалось сохранить.');
        // 409 — состояние строки уже другое: перечитываем, кнопка уйдёт.
        if (err.code === 'wrong_accrual_status') this.reload();
        this.msg.error(err.message);
      },
    });
  }

  // ---- UTM (менеджер) ----

  public readonly editingUtm = signal<string | null>(null);

  public utmUrl = '';

  public openUtm(creatorId: string): void {
    this.utmUrl = this.utm().find((u) => u.creator_user_id === creatorId)?.url ?? '';
    this.editingUtm.set(creatorId);
  }

  public cancelUtm(): void {
    this.editingUtm.set(null);
  }

  public saveUtm(): void {
    const creatorId = this.editingUtm();
    if (!creatorId) return;
    const url = this.utmUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      this.msg.error('Ссылка должна начинаться с http:// или https://');
      return;
    }
    this.busy.set(`utm:${creatorId}`);
    this.api.managerSaveUtm(this.projectId(), creatorId, url).subscribe({
      next: (saved) => {
        this.busy.set(null);
        this.editingUtm.set(null);
        const rest = this.utm().filter((u) => u.creator_user_id !== saved.creator_user_id);
        this.patch({ utm: [...rest, saved] });
        this.msg.success('Метка сохранена');
      },
      error: (e) => {
        this.busy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось сохранить метку.').message);
      },
    });
  }

  // ---- загрузка ----

  private patch(part: Partial<ProjectBilling>): void {
    this.billing.set({ ...(this.billing() ?? {}), ...part });
  }

  private replacePayment(saved: Payment): void {
    const rest = this.payments().filter((p) => p.kind !== saved.kind);
    this.patch({ payments: [...rest, saved] });
  }

  private reload(): void {
    this.load(this.projectId(), this.role(), this.period());
  }

  private loadPeriods(id: string): void {
    this.api.managerPeriods(id).subscribe({
      next: (r) => this.periods.set(r.items ?? []),
      // Периодов может не быть вовсе — про это скажет сам экран.
      error: () => this.periods.set([]),
    });
  }

  private load(id: string, role: BillingRole, period: number | null): void {
    const seq = period ?? undefined;
    const req =
      role === 'manager' ? this.api.managerBilling(id, seq) : this.api.clientBilling(id, seq);
    req.subscribe({
      next: (r) => {
        this.noPeriods.set(false);
        this.billing.set(r);
        // Номер текущего периода — он же число периодов у проекта.
        if (period === null && r.period) this.topSeq.set(r.period.seq);
      },
      error: (e) => {
        const err = parseApiError(e, '');
        // 404 no_periods — у проекта не вышло ни одного ролика. Это
        // состояние, а не сбой: отсчёт начинается с первой публикации.
        // Условий у проекта тоже может не быть вовсе — блок не появится.
        this.noPeriods.set(err.code === 'no_periods');
        this.billing.set(null);
      },
    });
  }
}
