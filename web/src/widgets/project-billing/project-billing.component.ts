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
  CreatorSubscribers,
  Payment,
  PaymentKind,
  PeriodTotals,
  ProjectBilling,
  ProjectPeriod,
  UtmLink,
} from '@entities/billing/model/billing.types';
import {
  PAYMENT_KIND_LABEL,
  PAYMENT_KIND_MISSING,
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_LABEL,
  accrualStatus,
  bonusTotal,
  canApprove,
  canConfirmPayment,
  canEditPayment,
  canMarkPaid,
  clickTiers,
  clicksEnabled,
  formatMoney,
  fromRubles,
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
  periodDay,
  periodOptions,
  periodRange,
  periodTitle,
  snapshotNote,
} from '@entities/billing/lib/period';
import { creatorLabel } from '@entities/publication/lib/publication-status';
import { parseApiError } from '@shared/api/api-error';
import { withScheme } from '@shared/lib/url';
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
  styleUrls: ['./project-billing.component.scss', './project-billing.component.touch.scss'],
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

  /**
   * Конвейер периода: пересчитали → подытожили → утвердили → выплатили.
   *
   * Шаги были размазаны по экрану: «Пересчитать» в шапке, «Утвердить» и
   * «Выплатить» — в строках таблицы, а состояние периода приходилось
   * собирать взглядом. Между тем порядок здесь жёсткий (выплатить
   * неутверждённое бэк не даст), и именно порядок менеджер держит в
   * голове. Полоса показывает, где период стоит сейчас и какой шаг
   * следующий.
   *
   * «Подытожить» руками не делается: период запирается сам через две
   * недели после конца. Поэтому шаг есть, а кнопки у него нет — и это
   * честнее, чем рисовать кнопку, которая ничего не сделает.
   */
  public readonly pipeline = computed(() => {
    const rows = this.accruals();
    const locked = this.shown()?.status === 'locked';
    // Предварительная строка не утверждена и не может быть: её нет в
    // базе, статуса у неё тоже нет — сервер отдаёт пустую строку. Без
    // этой оговорки непересчитанный период показывал «утверждено».
    const saved = rows.filter((a) => !a.is_preview);
    const approved =
      saved.length === rows.length && saved.length > 0 && saved.every((a) => a.status !== 'draft');
    const paid =
      saved.length === rows.length && saved.length > 0 && saved.every((a) => a.status === 'paid');
    // «Пересчитано» — это существование сохранённых строк: у
    // непересчитанного периода строки приходят предварительными.
    const counted = rows.length > 0 && rows.some((a) => !a.is_preview);
    return [
      {
        key: 'recalc',
        title: 'Пересчитать',
        note: 'просмотры с площадок',
        done: counted,
        current: !counted,
      },
      {
        key: 'lock',
        title: 'Подытожить',
        note: locked ? 'срез снят' : 'через две недели после конца периода, сам',
        done: locked,
        current: counted && !locked,
      },
      {
        key: 'approve',
        title: 'Утвердить',
        note: 'суммы фиксируются',
        done: approved,
        current: locked && !approved,
      },
      {
        key: 'pay',
        title: 'Выплатить',
        note: 'отправка на карты',
        done: paid,
        current: approved && !paid,
      },
    ];
  });

  /**
   * Утвердить всё, что ещё в черновике: по одной строке их десяток.
   *
   * Предварительные строки пропускаем: их нет в базе, утверждать нечего
   * — сперва «Пересчитать».
   */
  public approveAll(): void {
    for (const a of this.accruals()) if (a.status === 'draft' && !a.is_preview) this.approve(a);
  }

  /** Выплатить всё утверждённое разом. */
  public payAll(): void {
    for (const a of this.accruals()) if (a.status === 'approved') this.markPaid(a);
  }

  public readonly canApproveAll = computed(
    () => this.isManager() && this.accruals().some((a) => a.status === 'draft' && !a.is_preview),
  );

  public readonly canPayAll = computed(
    () => this.isManager() && this.accruals().some((a) => this.payable(a)),
  );

  /**
   * Журнал периода: что и когда с деньгами делали.
   *
   * Собирается из самих строк и периода — отдельной ленты событий у
   * денег нет, а вопрос «кто это утвердил и когда» возникает каждый
   * раз, когда сумма кому-то не нравится.
   */
  public readonly journal = computed(() => {
    const out: { at: string; text: string }[] = [];
    const p = this.shown();
    // locked_at есть только в менеджерском виде периода: клиентскому
    // механика цепочки не отдаётся вовсе.
    const lockedAt = p && 'locked_at' in p ? ((p as ProjectPeriod).locked_at ?? '') : '';
    if (lockedAt) out.push({ at: lockedAt, text: 'Период подытожен — срез снят' });
    for (const a of this.accruals()) {
      const who = a.creator_name || 'креатор';
      if (a.approved_at) out.push({ at: a.approved_at, text: `Утверждено: ${who}` });
      if (a.paid_at) out.push({ at: a.paid_at, text: `Выплачено: ${who}` });
    }
    return out.sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 8);
  });

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

  /** «13 октября» — последний день периода. */
  public readonly periodEnd = computed(() => {
    const p = this.shown();
    return p ? periodDay(p.ends_on) : '';
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

  /**
   * Оклад один или их несколько.
   *
   * «Оклады за период» при одном креаторе в составе — не обобщение, а
   * ошибка согласования: читатель ищет глазами вторую строку, которой нет.
   */
  public readonly salaryTitle = computed(() => {
    // Фикс считается за ролик, и «Оклады за период» назвали бы на этой
    // строке выключенную механику: заплачено за вышедшие ролики, а не за
    // прожитый месяц.
    if (this.terms()?.fee_per_video) return 'Фикс за ролики';
    return this.accruals().length === 1 ? 'Оклад за период' : 'Оклады за период';
  });

  /** Та же подпись столбцом таблицы — там места на «за период» нет. */
  public readonly salaryCol = computed(() => (this.terms()?.fee_per_video ? 'Фикс' : 'Оклад'));

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

  /** Состояние строки: у непересчитанной его нет — она «предварительная». */
  public status(a: Accrual): { label: string; color: string } {
    return accrualStatus(a);
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
    // Схему дописываем сами: метку копируют из аналитики заказчика, и
    // «https://» там в начале бывает не всегда.
    const url = withScheme(this.utmUrl);
    if (!url) {
      this.msg.error('Это не похоже на ссылку — нужен адрес вида site.ru/?utm_source=...');
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

  // ---- подписчики (менеджер) ----
  //
  // Прирост снимает обход аккаунтов: срез аудитории на входе в период,
  // срез в конце, разница. Ручная правка остаётся сверху — это решение
  // менеджера по спорному случаю (аккаунт отдали поздно, часть роста не
  // от проекта, площадка соврала). Считает деньги по итоговому числу
  // сервер: в браузере тариф не считается никогда.

  /**
   * Доплата за подписчиков объявлена в условиях проекта.
   *
   * Любой из двух форм: цена за одного или ступени прироста. По одной
   * ставке блок пропадал бы у проектов, где цена задана лесенкой, — то
   * есть ровно там, где подписчики стоят дороже всего.
   */
  public readonly subsOn = computed(() => {
    const t = this.terms();
    return (t?.subscriber_rate ?? 0) > 0 || (t?.subscriber_steps?.length ?? 0) > 0;
  });

  /** Снятое обходом и ручные правки по каждому креатору периода. */
  public readonly subs = signal<CreatorSubscribers[]>([]);

  /** Что известно про подписчиков этого креатора. */
  public subsOf(creatorId: string): CreatorSubscribers | undefined {
    return this.subs().find((c) => c.creator_user_id === creatorId);
  }

  public readonly editingSubs = signal<string | null>(null);

  public subsValue = 0;

  public openSubs(creatorId: string): void {
    this.subsValue = this.accruals().find((a) => a.creator_user_id === creatorId)?.subscribers ?? 0;
    this.editingSubs.set(creatorId);
  }

  /**
   * Вернуть снятое обходом.
   *
   * Отдельным действием, а не «впишите ноль»: ноль — это объявленное
   * «роста не было», и платить по нему тоже решение. Различать их обязан
   * интерфейс, а не догадка сервера.
   */
  public dropSubs(creatorId: string): void {
    const seq = this.selectedSeq();
    if (seq === null) return;
    this.busy.set(`subs:${creatorId}`);
    this.api.managerDropSubscribers(this.projectId(), creatorId, seq).subscribe({
      next: () => {
        this.busy.set(null);
        this.editingSubs.set(null);
        this.reload();
        this.msg.success('Вернули число, снятое обходом');
      },
      error: (e) => {
        this.busy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось вернуть снятое число.').message);
      },
    });
  }

  public cancelSubs(): void {
    this.editingSubs.set(null);
  }

  public saveSubs(): void {
    const creatorId = this.editingSubs();
    if (creatorId === null) return;
    const n = Math.round(Number(this.subsValue));
    if (!Number.isFinite(n) || n < 0) {
      this.msg.error('Подписчиков не бывает меньше нуля.');
      return;
    }
    const seq = this.selectedSeq();
    if (seq === null) {
      this.msg.error('Периода ещё нет — вписывать подписчиков не к чему.');
      return;
    }
    this.busy.set(`subs:${creatorId}`);
    this.api.managerSaveSubscribers(this.projectId(), creatorId, n, seq).subscribe({
      next: () => {
        this.busy.set(null);
        this.editingSubs.set(null);
        // Перезагрузка целиком, а не правка строки в памяти: от числа
        // подписчиков зависит вся сумма периода, и пересчитать её здесь
        // значило бы завести в браузере вторую версию тарифа.
        this.reload();
        this.msg.success('Подписчики записаны');
      },
      error: (e) => {
        this.busy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось записать подписчиков.').message);
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

  /**
   * Подписчики — своим запросом рядом с остальным.
   *
   * Молча пустой список при ошибке: доплата за подписчиков есть не у
   * всех проектов, и ронять экран денег из-за неё нельзя — суммы в нём
   * уже посчитаны сервером и верны.
   */
  private loadSubs(id: string, period: number | null): void {
    this.api.managerSubscribers(id, period ?? undefined).subscribe({
      next: (r) => this.subs.set(r.items ?? []),
      error: () => this.subs.set([]),
    });
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
    // Только менеджеру: заказчику список правок ни к чему, а ручка
    // менеджерская и ответила бы ему отказом.
    if (role === 'manager') this.loadSubs(id, period);
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
