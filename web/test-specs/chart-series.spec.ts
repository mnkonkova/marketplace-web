import {
  dayNumber,
  labelledPoints,
  niceMax,
  placeSeries,
  splitGaps,
} from '@shared/lib/chart-series';

/**
 * Разбор ряда для линейного графика.
 *
 * Проверяем здесь ровно то, что график РЕШАЕТ про данные: где встаёт
 * точка на оси времени, где линия рвётся и докуда достаёт шкала. Всё это
 * внутри компонента видно только по отрисованному svg, то есть не видно
 * никак: ошибка выглядит как график, просто не тот.
 */
describe('chart-series', () => {
  describe('dayNumber', () => {
    /**
     * Дни приходят календарными. Разбирать их через new Date(iso) нельзя:
     * восточнее Гринвича '2026-09-10' становится 9 сентября по местному
     * времени, и весь ряд уезжает на сутки — молча и целиком.
     */
    it('соседние дни отличаются на единицу независимо от часового пояса', () => {
      expect(dayNumber('2026-09-11')! - dayNumber('2026-09-10')!).toBe(1);
      expect(dayNumber('2026-03-01')! - dayNumber('2026-02-28')!).toBe(1);
      expect(dayNumber('2027-01-01')! - dayNumber('2026-12-31')!).toBe(1);
    });

    it('время в строке не меняет дня', () => {
      expect(dayNumber('2026-09-10T23:40:00Z')).toBe(dayNumber('2026-09-10'));
    });

    /** Точка без разбираемой даты не знает, где ей стоять. */
    it('мусор — не ноль, а «даты нет»', () => {
      expect(dayNumber('')).toBeNull();
      expect(dayNumber('позавчера')).toBeNull();
    });
  });

  describe('placeSeries', () => {
    it('ряд выстраивается по датам, а не по порядку в массиве', () => {
      const out = placeSeries([
        { date: '2026-09-12', value: 3 },
        { date: '2026-09-10', value: 1 },
        { date: '2026-09-11', value: 2 },
      ]);
      expect(out.map((p) => p.value)).toEqual([1, 2, 3]);
      expect(out.map((p) => p.day)).toEqual([0, 1, 2]);
    });

    /**
     * Позиция в ДНЯХ, а не по номеру точки: две недели тишины обязаны
     * выглядеть как две недели. Разложенные по номеру, точки встали бы
     * вплотную, и провал читался бы как обычный шаг ряда.
     */
    it('дыра в ряду раздвигает точки по оси времени', () => {
      const out = placeSeries([
        { date: '2026-09-01', value: 10 },
        { date: '2026-09-15', value: 20 },
      ]);
      expect(out.map((p) => p.day)).toEqual([0, 14]);
    });

    it('две записи на один день — это один день, а не два', () => {
      const out = placeSeries([
        { date: '2026-09-10', value: 1 },
        { date: '2026-09-10', value: 5 },
      ]);
      expect(out.length).toBe(1);
      expect(out[0].value).toBe(5);
    });

    it('точки без даты выбрасываются, а не рисуются наугад', () => {
      const out = placeSeries([
        { date: '2026-09-10', value: 1 },
        { date: 'вчера', value: 99 },
      ]);
      expect(out.map((p) => p.value)).toEqual([1]);
    });
  });

  describe('splitGaps', () => {
    /**
     * Ноль просмотров и «в этот день не собирали» — разные вещи. Ноль мы
     * измерили: он рисуется нулём и линию не рвёт. Пропущенного дня мы не
     * мерили вовсе, и любая линия через него — выдумка: по нулю соврёт
     * провалом, по соседям — ровным ростом.
     */
    it('ноль линию не рвёт: это измеренное число', () => {
      const runs = splitGaps(
        placeSeries([
          { date: '2026-09-10', value: 40_000 },
          { date: '2026-09-11', value: 0 },
          { date: '2026-09-12', value: 20_000 },
        ]),
      );
      expect(runs.length).toBe(1);
      expect(runs[0].map((p) => p.value)).toEqual([40_000, 0, 20_000]);
    });

    it('пропущенный день линию рвёт', () => {
      const runs = splitGaps(
        placeSeries([
          { date: '2026-09-10', value: 40_000 },
          { date: '2026-09-12', value: 20_000 },
          { date: '2026-09-13', value: 30_000 },
        ]),
      );
      expect(runs.length).toBe(2);
      expect(runs[0].map((p) => p.date)).toEqual(['2026-09-10']);
      expect(runs[1].map((p) => p.date)).toEqual(['2026-09-12', '2026-09-13']);
    });

    it('сплошной ряд остаётся одной линией', () => {
      const days = Array.from({ length: 30 }, (_, i) => ({
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        value: i,
      }));
      expect(splitGaps(placeSeries(days)).length).toBe(1);
    });
  });

  describe('niceMax', () => {
    /**
     * Без округления верхняя подпись оси повторяет максимум, и шкала
     * читается как «до сих пор», а не «до столько-то». Уже круглый
     * максимум так и остаётся собой — задирать шкалу над ним незачем.
     */
    it('верх шкалы — круглое число не ниже максимума', () => {
      expect(niceMax([120_000])).toBe(150_000);
      expect(niceMax([3_100_000])).toBe(3_500_000);
      expect(niceMax([40_000, 0, 20_000])).toBe(40_000);
    });

    /** Ряд из одних нулей: делить на ноль нечего, вся линия ушла бы в NaN. */
    it('нулевой ряд даёт ненулевую шкалу', () => {
      expect(niceMax([0, 0])).toBe(1);
      expect(niceMax([])).toBe(1);
    });
  });

  describe('labelledPoints', () => {
    it('дат под осью не больше, чем читается, и последняя всегда подписана', () => {
      const placed = placeSeries(
        Array.from({ length: 30 }, (_, i) => ({
          date: `2026-09-${String(i + 1).padStart(2, '0')}`,
          value: i,
        })),
      );
      const ticks = labelledPoints(placed);
      expect(ticks.length).toBeLessThanOrEqual(7);
      expect(ticks[0].date).toBe('2026-09-01');
      expect(ticks[ticks.length - 1].date).toBe('2026-09-30');
    });
  });
});
