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
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { BillingApi } from '@entities/billing/api/billing.api';
import {
  Accrual,
  Payment,
  PaymentKind,
  PeriodTotals,
  ProjectBilling,
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
  currentMonthKey,
  formatMoney,
  fromRubles,
  monthLabel,
  isPreviewPeriod,
  recalcAffects,
  isFromOrder,
  recentMonths,
  salaryScopeTiers,
  teamOrder,
  shortfall,
  toRubles,
  viewsTiers,
} from '@entities/billing/lib/money';
import { creatorLabel } from '@entities/publication/lib/publication-status';
import { parseApiError } from '@shared/api/api-error';
import { plural } from '@shared/lib/format';

export type BillingRole = 'manager' | 'client';

// Деньги проекта. Заказчик видит условия, платежи, итог периода и
// «Команду месяца» — кто сколько сдал и во сколько это ему обошлось: он
// за неё платит, и «60 000 + 5 850» это его счёт. Менеджер вдобавок
// пересчитывает, утверждает, отмечает выплату и ставит UTM-метки —
// меток заказчику бэк не отдаёт, это инструмент менеджера.
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

  public readonly month = signal(currentMonthKey());

  public readonly months = recentMonths(12);

  public readonly busy = signal<string | null>(null);

  public constructor() {
    effect(() => {
      const id = this.projectId();
      const role = this.role();
      // Месяц читаем как зависимость: смена периода перечитывает начисления.
      const month = this.month();
      if (id) this.load(id, role, month);
    });
  }

  public readonly isManager = computed(() => this.role() === 'manager');

  public readonly terms = computed(() => this.billing()?.terms ?? null);

  public readonly payments = computed(() => this.billing()?.payments ?? []);

  public readonly accruals = computed(() => this.billing()?.accruals ?? []);

  public readonly utm = computed(() => this.billing()?.utm ?? []);

  public readonly totals = computed<PeriodTotals | null>(() => this.billing()?.totals ?? null);

  // Блок вообще есть, если у проекта заведены условия или платежи. Пустой
  // «К оплате» на проекте без тарифа — шум.
  public readonly hasAnything = computed(
    () => !!this.terms() || this.payments().length > 0 || this.accruals().length > 0,
  );

  public readonly monthTitle = computed(() => monthLabel(this.month()));

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

  // «Команда месяца» у заказчика: кто сколько сдал и во сколько обошёлся.
  public readonly team = computed(() => teamOrder(this.accruals()));

  public readonly fromOrder = computed(() => isFromOrder(this.accruals()));

  // Пересчёт трогает только черновики: утверждённое и выплаченное он не
  // меняет. Если черновиков нет, кнопка ничего не сделает.
  public readonly draftsCount = computed(() => recalcAffects(this.accruals()));

  /** Месяц показан расчётом: строк в базе ещё нет. */
  public readonly previewPeriod = computed(() => isPreviewPeriod(this.accruals()));

  /**
   * Оклад один или их несколько.
   *
   * «Оклады за сентябрь» при одном креаторе в составе — не обобщение, а
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

  public setMonth(value: string): void {
    this.month.set(value);
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
    this.api.managerRecalcAccruals(this.projectId(), this.month()).subscribe({
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
        'в следующий месяц.',
      nzOnOk: () => this.act(a, 'approve'),
    });
  }

  public markPaid(a: Accrual): void {
    this.act(a, 'paid');
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
    this.load(this.projectId(), this.role(), this.month());
  }

  private load(id: string, role: BillingRole, month: string): void {
    const req =
      role === 'manager' ? this.api.managerBilling(id, month) : this.api.clientBilling(id, month);
    req.subscribe({
      next: (r) => this.billing.set(r),
      // Условий у проекта может не быть вовсе — блок тогда не появится.
      error: () => this.billing.set(null),
    });
  }
}
