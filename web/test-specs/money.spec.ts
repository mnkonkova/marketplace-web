import {
  bonusTotal,
  canApprove,
  canConfirmPayment,
  canEditPayment,
  canMarkPaid,
  clickTiers,
  clicksEnabled,
  formatMoney,
  fromRubles,
  monthLabel,
  isFromOrder,
  recalcAffects,
  salaryScopeTiers,
  shortfall,
  teamOrder,
  toRubles,
  viewsTiers,
} from '@entities/billing/lib/money';
import { Accrual, BillingTerms, Payment } from '@entities/billing/model/billing.types';

// Разряды и знак валюты отделяются неразрывным пробелом: обычный в этих
// местах даёт перенос строки посреди суммы.
const NB = '\u00a0';

function terms(over: Partial<BillingTerms> = {}): BillingTerms {
  return {
    project_id: 'pr1',
    // 60 000 ₽ / мес, 90 ₽ за 1000 до миллиона, 9 ₽ свыше.
    salary_per_month: 6_000_000,
    rate_per_1000_views: 9_000,
    rate_per_1000_views_over: 900,
    bonus_views_threshold: 1_000_000,
    ...over,
  };
}

function accrual(over: Partial<Accrual> = {}): Accrual {
  return {
    id: 'a1',
    project_id: 'pr1',
    creator_user_id: 'u1',
    period_start: '2026-08-15T00:00:00Z',
    status: 'draft',
    salary: 6_000_000,
    views_base: 107_460,
    views_over: 0,
    views_total: 107_460,
    views_bonus: 967_100,
    clicks: 0,
    click_bonus: 0,
    videos_planned: 4,
    videos_delivered: 4,
    deduction: 0,
    total: 6_967_100,
    ...over,
  };
}

describe('formatMoney: копейки на экран', () => {
  it('круглая сумма показывается без копеек', () => {
    expect(formatMoney(18_000_000)).toBe(`180${NB}000${NB}₽`);
  });

  it('копейки показываются, когда они есть', () => {
    expect(formatMoney(74_635)).toBe(`746,35${NB}₽`);
    expect(formatMoney(74_605)).toBe(`746,05${NB}₽`);
  });

  it('ноль — это ноль, а не прочерк', () => {
    expect(formatMoney(0)).toBe(`0${NB}₽`);
  });

  it('отсутствие числа — прочерк', () => {
    // cost_per_1000 пуст, пока просмотров нет: делить не на что.
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(null)).toBe('—');
  });

  it('отрицательная сумма показывается минусом', () => {
    expect(formatMoney(-150_000)).toBe(`−1${NB}500${NB}₽`);
  });
});

describe('перевод рублей и копеек', () => {
  it('рубли из формы уходят копейками без потери знака', () => {
    expect(fromRubles(90)).toBe(9000);
    expect(fromRubles(0.09)).toBe(9);
    // Классическая проблема float: 60000.07 * 100 = 6000006.999...
    expect(fromRubles(60_000.07)).toBe(6_000_007);
  });

  it('обратный перевод возвращает исходное', () => {
    expect(toRubles(fromRubles(1234.56))).toBe(1234.56);
  });
});

describe('viewsTiers: ступени тарифа за просмотры', () => {
  it('с порогом получается две ступени', () => {
    const tiers = viewsTiers(terms());
    expect(tiers.length).toBe(2);
    expect(tiers[0].value).toBe(`90${NB}₽ / 1000`);
    expect(tiers[0].note).toContain(`до 1${NB}000${NB}000`);
    expect(tiers[1].value).toBe(`9${NB}₽ / 1000`);
    expect(tiers[1].note).toContain(`свыше 1${NB}000${NB}000`);
  });

  it('без порога ступень одна — второй строки быть не должно', () => {
    // Порог 0 значит «весь объём по полной ставке». Нарисовать вторую
    // строку значило бы соврать про несуществующее правило.
    const tiers = viewsTiers(terms({ bonus_views_threshold: 0 }));
    expect(tiers.length).toBe(1);
    expect(tiers[0].note).toBe('на весь объём просмотров');
  });
});

describe('clickTiers: переходы', () => {
  it('без ставки бонус за переходы выключен', () => {
    const t = terms();
    expect(clicksEnabled(t)).toBeFalse();
    expect(clickTiers(t)).toEqual([]);
  });

  it('нулевая ставка — это заданная ставка, а не выключенный бонус', () => {
    expect(clicksEnabled(terms({ click_bonus_rate: 0 }))).toBeTrue();
  });

  it('порог здесь месячный, а не на ролик', () => {
    const tiers = clickTiers(
      terms({ click_bonus_rate: 7000, click_bonus_rate_over: 700, click_bonus_threshold: 1000 }),
    );
    expect(tiers.length).toBe(2);
    expect(tiers[0].note).toContain('за месяц');
    expect(tiers[1].note).toContain('за месяц');
  });
});

describe('порядок действий с начислением', () => {
  it('утвердить можно только черновик', () => {
    expect(canApprove(accrual({ status: 'draft' }))).toBeTrue();
    expect(canApprove(accrual({ status: 'approved' }))).toBeFalse();
    expect(canApprove(accrual({ status: 'paid' }))).toBeFalse();
  });

  it('выплатить можно только утверждённое', () => {
    // Между «посчитали» и «отправили деньги» проходит время, и путать их
    // нельзя: бэк на попытку ответит 409 wrong_accrual_status.
    expect(canMarkPaid(accrual({ status: 'draft' }))).toBeFalse();
    expect(canMarkPaid(accrual({ status: 'approved' }))).toBeTrue();
    expect(canMarkPaid(accrual({ status: 'paid' }))).toBeFalse();
  });

  it('пересчёт трогает только черновики', () => {
    const rows = [
      accrual({ id: '1', status: 'draft' }),
      accrual({ id: '2', status: 'approved' }),
      accrual({ id: '3', status: 'paid' }),
      accrual({ id: '4', status: 'draft' }),
    ];
    expect(recalcAffects(rows)).toBe(2);
  });
});

describe('shortfall: недостача по роликам', () => {
  it('считает разницу между планом и сдачей', () => {
    expect(shortfall(accrual({ videos_planned: 4, videos_delivered: 3 }))).toBe(1);
  });

  it('перевыполнение не уходит в минус', () => {
    expect(shortfall(accrual({ videos_planned: 3, videos_delivered: 4 }))).toBe(0);
  });
});

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: 'pay1',
    project_id: 'pr1',
    kind: 'prepayment',
    amount: 9_000_000,
    status: 'awaiting',
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

describe('salaryScopeTiers: за какой объём назван оклад', () => {
  it('обе ступени превращаются в подписи «30 видео / 60 со второго»', () => {
    const tiers = salaryScopeTiers(terms({ videos_first_month: 30, videos_next_months: 60 }));
    expect(tiers.length).toBe(2);
    expect(tiers[0].value).toBe('30 видео');
    expect(tiers[0].note).toBe('первый месяц');
    expect(tiers[1].value).toBe('60 видео / мес');
  });

  it('объём не задан — подписи нет, а не «0 видео»', () => {
    // Сумма оклада без объёма ни о чём не говорит, но выдумывать объём
    // хуже, чем не показать его вовсе.
    expect(salaryScopeTiers(terms())).toEqual([]);
    expect(salaryScopeTiers(terms({ videos_first_month: 0, videos_next_months: 0 }))).toEqual([]);
  });

  it('задана только одна ступень — показывается одна', () => {
    expect(salaryScopeTiers(terms({ videos_first_month: 30 })).length).toBe(1);
  });
});

describe('состояние платежа', () => {
  it('править и подтверждать можно только ожидающий', () => {
    expect(canEditPayment(payment({ status: 'awaiting' }))).toBeTrue();
    expect(canConfirmPayment(payment({ status: 'awaiting' }))).toBeTrue();
  });

  it('подтверждённый платёж задним числом не переписывается', () => {
    // Бэк ответит 409 already_confirmed — кнопку не показываем вовсе.
    expect(canEditPayment(payment({ status: 'confirmed' }))).toBeFalse();
    expect(canConfirmPayment(payment({ status: 'confirmed' }))).toBeFalse();
  });

  it('отменённый платёж не подтверждают', () => {
    expect(canConfirmPayment(payment({ status: 'cancelled' }))).toBeFalse();
  });

  it('незаведённый платёж можно задать, но не подтвердить', () => {
    expect(canEditPayment(undefined)).toBeTrue();
    expect(canConfirmPayment(undefined)).toBeFalse();
  });
});

describe('«Команда месяца» у заказчика', () => {
  const masha = accrual({ id: 'm', creator_name: 'Маша', priority: 1 });
  const nastya = accrual({ id: 'n', creator_name: 'Анастасия', priority: 2 });
  const andrey = accrual({ id: 'a', creator_name: 'Андрей', priority: 3 });

  it('порядок — по приоритету подборки, а не по алфавиту', () => {
    expect(teamOrder([andrey, masha, nastya]).map((a) => a.id)).toEqual(['m', 'n', 'a']);
  });

  it('строки без приоритета уходят в конец, а не встают первыми', () => {
    // priority=0 значит «заведён руками». Считать его нулевым приоритетом
    // значило бы поставить такого человека выше первого по подборке.
    const manual = accrual({ id: 'x', creator_name: 'Борис', priority: 0 });
    expect(teamOrder([manual, nastya, masha]).map((a) => a.id)).toEqual(['m', 'n', 'x']);
  });

  it('при равном приоритете сортирует по имени', () => {
    const a1 = accrual({ id: '1', creator_name: 'Яна' });
    const a2 = accrual({ id: '2', creator_name: 'Аня' });
    expect(teamOrder([a1, a2]).map((a) => a.id)).toEqual(['2', '1']);
  });

  it('подпись «собрана по вашему приоритету» — только у проекта из заказа', () => {
    expect(isFromOrder([masha, nastya])).toBeTrue();
    expect(isFromOrder([accrual({ priority: 0 }), accrual({})])).toBeFalse();
  });

  it('бонус в «60 000 + 5 850» складывает просмотры и переходы', () => {
    expect(bonusTotal(accrual({ views_bonus: 585_000, click_bonus: 7_000 }))).toBe(592_000);
  });
});

describe('календарный месяц', () => {
  // Единственный настоящий календарный месяц, который остался: месяц
  // старта заказа. Периоды проекта подписываются датами — см.
  // period.spec.ts.
  it('подпись месяца — по-русски', () => {
    expect(monthLabel('2026-08')).toBe('август 2026');
  });

  it('неизвестный ключ возвращается как есть, а не «undefined»', () => {
    expect(monthLabel('')).toBe('');
  });
});
