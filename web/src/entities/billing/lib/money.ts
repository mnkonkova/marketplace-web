import {
  Accrual,
  AccrualStatus,
  BillingTerms,
  Payment,
  PaymentKind,
  PaymentStatus,
} from '../model/billing.types';

// Деньги приходят в копейках и в копейках же считаются. Рубли появляются
// только на экране — иначе «90 ₽ за 1000 просмотров» на 107 460 просмотрах
// даёт то 9 671, то 9 672 в зависимости от того, где округлили.

// Разряды делим неразрывным пробелом сами, а не toLocaleString: браузеры
// с разной ICU ставят то U+00A0, то U+202F, и одна и та же сумма в двух
// местах экрана выглядела по-разному.
const NBSP = '\u00a0';

export function groupDigits(n: number): string {
  return String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

// Копейки → строка с рублями. Дробную часть показываем только когда она
// есть: «180 000 ₽», но «746,35 ₽».
export function formatMoney(kopecks: number | null | undefined): string {
  if (kopecks === null || kopecks === undefined) return '—';
  const sign = kopecks < 0 ? '−' : '';
  const abs = Math.abs(kopecks);
  const rub = Math.floor(abs / 100);
  const kop = abs % 100;
  const head = groupDigits(rub);
  return kop === 0
    ? `${sign}${head}${NBSP}₽`
    : `${sign}${head},${String(kop).padStart(2, '0')}${NBSP}₽`;
}

// Копейки в число рублей — для мест, где рядом стоит своя единица
// измерения («90 ₽ / 1000»).
export function toRubles(kopecks: number): number {
  return kopecks / 100;
}

export function fromRubles(rubles: number): number {
  return Math.round(rubles * 100);
}

export const ACCRUAL_STATUS_LABEL: Record<AccrualStatus, string> = {
  draft: 'Период открыт',
  approved: 'Утверждён',
  paid: 'Выплачено',
};

export const ACCRUAL_STATUS_COLOR: Record<AccrualStatus, string> = {
  draft: 'default',
  approved: 'blue',
  paid: 'green',
};

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  prepayment: 'Предоплата',
  final: 'Финальный платёж',
};

// «Предоплата — не заведён» звучало как машинный перевод. Род зависит от
// названия платежа, а не от состояния, поэтому форма лежит рядом с ним.
export const PAYMENT_KIND_MISSING: Record<PaymentKind, string> = {
  prepayment: 'не заведена',
  final: 'не заведён',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  awaiting: 'ждём',
  confirmed: 'получен',
  cancelled: 'отменён',
};

export const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  awaiting: 'gold',
  confirmed: 'green',
  cancelled: 'default',
};

// Подтверждать и править можно только то, что ещё ждёт денег.
// Подтверждённый платёж бэк не переписывает (409 already_confirmed), а
// отменённый подтверждать нечего.
export function canEditPayment(p?: Payment): boolean {
  return !p || p.status === 'awaiting';
}

export function canConfirmPayment(p?: Payment): boolean {
  return !!p && p.status === 'awaiting';
}

// Утвердить можно только черновик, выплатить — только утверждённое.
// Порядок жёсткий: между «посчитали» и «отправили деньги» проходит время,
// и путать их нельзя. Кнопку в неподходящем состоянии не показываем, а не
// ловим 409 wrong_accrual_status после нажатия.
export function canApprove(a: Accrual): boolean {
  // Непересчитанная строка живёт только в ответе: утверждать нечего, у
  // неё и id ещё нет.
  return a.status === 'draft' && !a.is_preview;
}

export function canMarkPaid(a: Accrual): boolean {
  return a.status === 'approved' && !a.is_preview;
}

// Пересчёт не трогает утверждённые и выплаченные строки — так «период
// закрыт» и работает. Если закрыто всё, кнопка пересчёта бесполезна.
export function recalcAffects(items: Accrual[]): number {
  return items.filter((a) => a.status === 'draft').length;
}

/** Месяц показан расчётом, а не сохранёнными строками. */
export function isPreviewPeriod(items: Accrual[]): boolean {
  return items.length > 0 && items.every((a) => a.is_preview);
}

// Недостача по ролику: сколько стояло и сколько закрыто. Вычет
// пропорционален, поэтому показываем и разницу, и сам вычет.
export function shortfall(a: Accrual): number {
  return Math.max(0, a.videos_planned - a.videos_delivered);
}

// «Команда месяца» у заказчика: порядок — по приоритету подборки, потом
// по имени. Приоритет 0 значит «проект заведён руками», такие строки
// уходят в конец: сортировать их вперёд как «нулевой приоритет» было бы
// ровно наоборот смыслу.
export function teamOrder(items: Accrual[]): Accrual[] {
  return [...items].sort(
    (a, b) =>
      (a.priority || Number.MAX_SAFE_INTEGER) - (b.priority || Number.MAX_SAFE_INTEGER) ||
      (a.creator_name ?? '').localeCompare(b.creator_name ?? ''),
  );
}

// Проект вырос из заказа — значит команда собрана по приоритету клиента,
// а не выбрана вручную. У заведённого руками проекта приоритета нет ни
// у кого, и подпись «собрана по вашему приоритету» была бы неправдой.
export function isFromOrder(items: Accrual[]): boolean {
  return items.some((a) => (a.priority ?? 0) > 0);
}

// Бонус строки целиком: за просмотры плюс за переходы. Это второе
// слагаемое в «60 000 + 5 850» из макета.
export function bonusTotal(a: Accrual): number {
  return a.views_bonus + a.click_bonus;
}

// Подпись к окладу: за какой объём он назван. «30 видео первый месяц,
// 60 со второго» — без неё сумма оклада ни о чём не говорит. Пусто, если
// в тарифе объём не задан: выдумывать его нельзя.
export function salaryScopeTiers(terms: BillingTerms): RateTier[] {
  const out: RateTier[] = [];
  if (terms.videos_first_month) {
    out.push({ value: `${terms.videos_first_month} видео`, note: 'первый месяц' });
  }
  if (terms.videos_next_months) {
    out.push({ value: `${terms.videos_next_months} видео / мес`, note: 'со второго месяца' });
  }
  return out;
}

// Ступень тарифа для карточки «Условия и стоимость». Порог 0 значит, что
// ступени нет вовсе: весь объём по полной ставке, и вторую строку рисовать
// не надо — она бы соврала про несуществующее правило.
export interface RateTier {
  value: string;
  note: string;
}

export function viewsTiers(terms: BillingTerms): RateTier[] {
  const full: RateTier = {
    value: `${formatMoney(terms.rate_per_1000_views)} / 1000`,
    note: terms.bonus_views_threshold
      ? `до ${groupDigits(terms.bonus_views_threshold)} просмотров на ролик`
      : 'на весь объём просмотров',
  };
  if (!terms.bonus_views_threshold) return [full];
  return [
    full,
    {
      value: `${formatMoney(terms.rate_per_1000_views_over)} / 1000`,
      note: `свыше ${groupDigits(terms.bonus_views_threshold)} на ролик`,
    },
  ];
}

// Переходы: порог здесь МЕСЯЧНЫЙ, а не на ролик. Пустая ставка —
// источник кликов не подключён; блок показываем погашенным, как в макете.
export function clicksEnabled(terms: BillingTerms): boolean {
  return terms.click_bonus_rate !== undefined && terms.click_bonus_rate !== null;
}

export function clickTiers(terms: BillingTerms): RateTier[] {
  if (!clicksEnabled(terms)) return [];
  const threshold = terms.click_bonus_threshold ?? 0;
  const full: RateTier = {
    value: formatMoney(terms.click_bonus_rate),
    note: threshold ? `первые ${groupDigits(threshold)} переходов за месяц` : 'за каждый переход',
  };
  if (!threshold) return [full];
  return [
    full,
    { value: formatMoney(terms.click_bonus_rate_over), note: 'каждый следующий за месяц' },
  ];
}

// Месяц ГГГГ-ММ из даты первого числа периода — и обратно. Бэк отдаёт
// period_month датой, а в query ждёт ГГГГ-ММ.
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

const MONTH_NAMES = [
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

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  return name ? `${name} ${y}` : key;
}

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Последние n месяцев, свежий первым — выпадашка периода у менеджера.
export function recentMonths(n = 12, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
