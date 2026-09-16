import {
  isOpenPeriod,
  parsePeriodParam,
  periodDay,
  periodOf,
  periodOptions,
  periodRange,
  periodSettled,
  periodTitle,
  previousSeq,
  snapshotNote,
} from '@entities/billing/lib/period';
import type { CreatorPeriod, Payment, ProjectPeriod } from '@entities/billing/model/billing.types';

// Период не совпадает с календарным месяцем: он начинается датой первой
// публикации и катится от неё. Вышел первый ролик 15 сентября — периоды
// идут с 15-го по 14-е.
function period(over: Partial<ProjectPeriod> = {}): ProjectPeriod {
  return {
    id: 'p2',
    project_id: 'pr1',
    seq: 2,
    starts_on: '2026-09-15T00:00:00Z',
    ends_on: '2026-10-14T00:00:00Z',
    status: 'open',
    carry_in_client: 0,
    carry_out_client: 0,
    carry_in_creator: 0,
    carry_out_creator: 0,
    ...over,
  };
}

// 14 октября 2026 — внутри второго периода.
const NOW = new Date(2026, 9, 14);

describe('подпись периода', () => {
  it('период показан датами и номером, а не названием месяца', () => {
    // «сентябрь» здесь был бы неправдой: период с 15 сентября по 14
    // октября не совпадает ни с одним календарным месяцем, и это
    // главное, что человек должен понять с первого взгляда.
    expect(periodTitle(period(), NOW)).toBe('Период 2 · 15 сентября — 14 октября');
  });

  it('год дописывается, когда период не из текущего года', () => {
    const old = period({ seq: 1, starts_on: '2025-08-15', ends_on: '2025-09-14' });
    expect(periodRange(old, NOW)).toBe('15 августа 2025 — 14 сентября 2025');
  });

  it('год дописывается и когда период идёт через Новый год', () => {
    const cross = period({ starts_on: '2026-12-15', ends_on: '2027-01-14' });
    expect(periodRange(cross, NOW)).toBe('15 декабря 2026 — 14 января 2027');
  });

  it('дата берётся из строки, а не через Date — иначе часовой пояс сдвигает день', () => {
    // Границы приходят полуночью UTC. new Date() в браузере западнее
    // Гринвича показал бы 14 сентября вместо 15-го.
    expect(periodDay('2026-09-15T00:00:00Z')).toBe('15 сентября');
  });

  it('периода нет — подписи нет, а не «undefined»', () => {
    expect(periodTitle(null)).toBe('');
    expect(periodTitle(undefined)).toBe('');
  });
});

describe('состояние периода', () => {
  it('открытый период — предварительный', () => {
    expect(isOpenPeriod(period())).toBeTrue();
    expect(isOpenPeriod(period({ status: 'locked' }))).toBeFalse();
  });

  it('у подытоженного периода видно, на какую дату снят срез', () => {
    // «за период» не отвечает на вопрос, когда просмотры мерили: между
    // концом периода и срезом проходит две недели.
    const locked = period({ status: 'locked', snapshot_as_of: '2026-10-28T00:00:00Z' });
    expect(snapshotNote(locked)).toBe('по состоянию на 28 октября');
  });

  it('пока среза нет, приписки тоже нет', () => {
    expect(snapshotNote(period())).toBe('');
  });
});

describe('номер периода из адреса', () => {
  it('число читается как номер периода', () => {
    expect(parsePeriodParam('3')).toBe(3);
  });

  it('пусто — текущий период', () => {
    expect(parsePeriodParam(null)).toBeNull();
    expect(parsePeriodParam(undefined)).toBeNull();
    expect(parsePeriodParam('')).toBeNull();
  });

  it('мусор в адресе не роняет экран, а читается как «текущий»', () => {
    // Адрес правят руками и пересылают в чате. Опечатка в номере не
    // повод показать ошибку вместо денег.
    expect(parsePeriodParam('2026-09')).toBeNull();
    expect(parsePeriodParam('abc')).toBeNull();
    expect(parsePeriodParam('2.5')).toBeNull();
    expect(parsePeriodParam('-3')).toBeNull();
    expect(parsePeriodParam('0')).toBeNull();
  });
});

describe('список периодов', () => {
  it('в выпадашке свежий период первым', () => {
    const items = [period({ seq: 1 }), period({ seq: 3 }), period({ seq: 2 })];
    expect(periodOptions(items).map((p) => p.seq)).toEqual([3, 2, 1]);
  });

  it('у первого периода предыдущего не бывает', () => {
    expect(previousSeq(period({ seq: 1 }))).toBeNull();
    expect(previousSeq(period({ seq: 4 }))).toBe(3);
    expect(previousSeq(null)).toBeNull();
  });
});

describe('начисление и его период', () => {
  const periods: CreatorPeriod[] = [
    {
      seq: 1,
      starts_on: '2026-08-15T00:00:00Z',
      ends_on: '2026-09-14T00:00:00Z',
      status: 'locked',
      carry_in_creator: 0,
      carry_out_creator: 0,
    },
    {
      seq: 2,
      starts_on: '2026-09-15T00:00:00Z',
      ends_on: '2026-10-14T00:00:00Z',
      status: 'open',
      carry_in_creator: 0,
      carry_out_creator: 0,
    },
  ];

  it('строка заработка находит свой период по дате начала', () => {
    expect(periodOf(periods, '2026-09-15T00:00:00Z')?.seq).toBe(2);
  });

  it('периода не нашлось — null, а не выдуманные границы', () => {
    // Строка из старого расчёта по календарным месяцам не совпадёт ни с
    // одним периодом. Достроить ей границы прибавлением месяца значит
    // завести вторую копию правила периода.
    expect(periodOf(periods, '2026-09-01T00:00:00Z')).toBeNull();
    expect(periodOf(periods, '')).toBeNull();
  });
});

/**
 * По периоду рассчитались.
 *
 * Счёт за подытоженный период — единственное на экране заказчика, что
 * требует действия, и снимать его обязано поступление денег, а не смена
 * календаря. Раньше плашка «К оплате за прошлый период» жила ровно один
 * период: начинался следующий — и напоминание исчезало само, заплатили
 * по нему или нет.
 *
 * Платёжного провайдера у нас нет: деньги идут мимо системы, и
 * единственная отметка о получении — та, что менеджер ставит кнопкой
 * «Деньги пришли». Строка платежа в базе одна на проект и вид, а
 * периодов много, поэтому дата подтверждения здесь не формальность: без
 * неё оплата первого периода гасила бы счета за все следующие.
 */
describe('расчёт по периоду', () => {
  const closed = {
    seq: 1,
    starts_on: '2026-07-31',
    ends_on: '2026-08-30',
    status: 'locked' as const,
  };

  function pay(over: Partial<Payment> = {}): Payment {
    return {
      id: 'pay1',
      project_id: 'pr1',
      kind: 'final',
      amount: 1_050_000,
      status: 'confirmed',
      confirmed_at: '2026-09-02T10:00:00Z',
      created_at: '2026-08-01T00:00:00Z',
      ...over,
    };
  }

  it('подтверждённый финальный платёж после конца периода закрывает его', () => {
    expect(periodSettled(closed, [pay()])).toBeTrue();
  });

  it('подтверждение в день окончания периода засчитывается', () => {
    // Граница включительная с обеих сторон — как и сами границы периода.
    expect(periodSettled(closed, [pay({ confirmed_at: '2026-08-30T23:00:00Z' })])).toBeTrue();
  });

  it('подтверждение ДО конца периода относится не к нему', () => {
    // Платить за период, который ещё не кончился, было не за что: это
    // отметка по прошлому счёту, и гасить ею текущий нельзя.
    expect(periodSettled(closed, [pay({ confirmed_at: '2026-08-01T10:00:00Z' })])).toBeFalse();
  });

  it('выставленный, но не подтверждённый платёж не считается', () => {
    // awaiting — «сумму назвали, денег ещё нет».
    expect(
      periodSettled(closed, [pay({ status: 'awaiting', confirmed_at: undefined })]),
    ).toBeFalse();
  });

  it('предоплата период не закрывает', () => {
    // Предоплата — про старт работ, финальный — про закрытие периода.
    expect(periodSettled(closed, [pay({ kind: 'prepayment' })])).toBeFalse();
  });

  it('платежей нет — не рассчитались', () => {
    expect(periodSettled(closed, [])).toBeFalse();
    expect(periodSettled(closed, undefined)).toBeFalse();
  });

  it('периода нет — судить не о чем', () => {
    expect(periodSettled(null, [pay()])).toBeFalse();
  });
});
