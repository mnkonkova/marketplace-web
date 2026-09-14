/**
 * Разбор поденного ряда для линейного графика.
 *
 * Вынесено из компонента, потому что это единственное место, где график
 * что-то РЕШАЕТ про данные: где ряд прерывается, куда встаёт точка по
 * оси времени и какой у шкалы верх. Внутри компонента это проверялось бы
 * только через отрисованный svg, то есть не проверялось бы вовсе.
 */

/** Точка ряда: календарный день и измеренное за него число. */
export interface SeriesPoint {
  /** ГГГГ-ММ-ДД. Время, если оно пришло, отрезается. */
  date: string;
  value: number;
}

/** Та же точка, но с позицией на оси времени. */
export interface PlacedPoint extends SeriesPoint {
  /** Смещение в днях от первой точки ряда. */
  day: number;
}

const DAY_MS = 86_400_000;

/**
 * Номер календарного дня от эпохи.
 *
 * Режем строку и собираем полночь UTC, а не `new Date(iso)`: дни
 * приходят календарными, и восточнее Гринвича `new Date('2026-09-10')`
 * сдвинет точку на сутки назад — весь ряд поедет целиком и молча.
 *
 * Мусор на входе — null, а не NaN: точка без разбираемой даты не знает,
 * где ей стоять, и рисовать её наугад хуже, чем не рисовать.
 */
export function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/**
 * Ряд в порядке дат, с позицией каждой точки в днях от начала.
 *
 * Позиция именно в ДНЯХ, а не по порядковому номеру: если между двумя
 * замерами две недели дыры, точки обязаны стоять далеко друг от друга.
 * Разложенные по номеру, они встали бы вплотную, и двухнедельный провал
 * выглядел бы обычным шагом ряда.
 *
 * Повторы одной даты схлопываются в последнюю: две точки на одном дне —
 * это не два дня, а один, посчитанный дважды.
 */
export function placeSeries(points: readonly SeriesPoint[]): PlacedPoint[] {
  const byDay = new Map<number, PlacedPoint>();
  for (const p of points) {
    const n = dayNumber(p.date);
    if (n === null || !Number.isFinite(p.value)) continue;
    byDay.set(n, { date: p.date, value: p.value, day: n });
  }
  const sorted = [...byDay.values()].sort((a, b) => a.day - b.day);
  if (!sorted.length) return [];
  const base = sorted[0].day;
  return sorted.map((p) => ({ ...p, day: p.day - base }));
}

/**
 * Ряд, разрезанный по дырам: каждый кусок — подряд идущие дни.
 *
 * Пропущенный день и день с нулём — разные вещи, и линия обязана их
 * различать. Ноль мы измерили: в этот день ничего не прибавилось, и
 * провал в ноль — факт. Пропущенного дня мы не мерили вовсе, и любая
 * линия через него — выдумка: хоть по нулю, хоть по соседям. Поэтому
 * линия там просто рвётся.
 */
export function splitGaps(placed: readonly PlacedPoint[]): PlacedPoint[][] {
  const out: PlacedPoint[][] = [];
  let run: PlacedPoint[] = [];
  for (const p of placed) {
    const prev = run[run.length - 1];
    if (prev && p.day - prev.day > 1) {
      out.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * Верх шкалы — «круглое» число над максимумом ряда.
 *
 * Без округления верхняя подпись оси повторяет максимум («3 000 000»), и
 * шкала читается как «до сих пор», а не «до столько-то».
 *
 * Ноль на входе (ряд из одних нулей) даёт единицу: на нулевой шкале
 * делить не на что, и вся линия ушла бы в NaN.
 */
export function niceMax(values: readonly number[]): number {
  const max = values.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / (pow / 2)) * (pow / 2);
}

/**
 * Какие точки подписать датой по оси X.
 *
 * Не чаще, чем влезает: тридцать дат подряд сливаются в серую полосу, из
 * которой не прочесть ни одной. Последняя дата подписывается всегда —
 * без неё непонятно, по какое число нарисован график.
 */
export function labelledPoints(placed: readonly PlacedPoint[], max = 6): PlacedPoint[] {
  if (placed.length < 2) return [];
  const step = Math.max(1, Math.ceil(placed.length / max));
  const out: PlacedPoint[] = [];
  for (let i = 0; i < placed.length; i += step) out.push(placed[i]);
  const last = placed[placed.length - 1];
  if (out[out.length - 1]?.day !== last.day) out.push(last);
  return out;
}
