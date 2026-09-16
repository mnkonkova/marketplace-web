import { plural } from '@shared/lib/format';
import type { TypicalSource } from '../model/billing.types';

// Шкала прогресса креатора: ступени по просмотрам.
//
// Всё здесь — чистые функции над числами, и это намеренно. Считать
// «сколько роликов до ступени» внутри компонента значит проверять
// арифметику через вёрстку: тест на медиану превращается в тест на то,
// что в карточке нужный <b>. Компонент только раскладывает по экрану то,
// что посчитано тут.
//
// Денег здесь по-прежнему не СЧИТАЮТ. Сколько заработано за период и
// сколько добавит следующая ступень, знает сервер: первое приходит из
// начисления, второе — прогнозом (next_step_forecast), и считает его тот
// же код, что и настоящую выплату. Вторая копия расчёта денег в браузере
// разошлась бы с серверной на первой же правке ставок, и разошлась бы
// молча — заметили бы это в день выплаты.

/** Ступень шкалы — 100 000 просмотров. */
export const LADDER_STEP = 100_000;

/**
 * Возраст, с которого ролик считается зрелым.
 *
 * Те же две недели, через которые подытоживается период: к этому сроку
 * ролик набрал почти всё, что наберёт. Молодой ролик в медиане тянул бы
 * её вниз — не потому что он плохой, а потому что он вчерашний.
 */
export const MATURE_DAYS = 14;

/**
 * Сколько своих зрелых роликов нужно, чтобы медиана была про человека,
 * а не про случай. На трёх роликах медиана скачет вдвое от одного
 * удачного — тогда честнее взять медиану проекта.
 */
export const MIN_OWN_SAMPLE = 10;

/**
 * По скольким последним роликам считаем медиану.
 *
 * «Последних» — потому что человек растёт: ролики годовой давности
 * говорят о том, кем он был, а план на этот период строится по тому, кто
 * он сейчас.
 */
export const TYPICAL_WINDOW = 20;

/** Ролик для расчётов: только то, от чего зависят числа. */
export interface LadderVideo {
  id: string;
  title?: string;
  views: number;
  /** Когда вышел. Пусто — ещё не вышел, в расчёты не попадает. */
  published_at?: string;
}

export const TYPICAL_SOURCE_NOTE: Record<TypicalSource, string> = {
  creator: 'по твоим роликам',
  project: 'по роликам проекта: своих пока мало',
  default: 'средний ролик по площадке: истории пока нет',
};

export interface Typical {
  views: number;
  source: TypicalSource;
  /** По скольким роликам посчитано — чтобы не выдавать медиану двух за правило. */
  sample: number;
}

export function daysSince(iso: string, now: Date = new Date()): number {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.floor((now.getTime() - ts) / 86_400_000);
}

/** Ролик старше двух недель: его просмотрам можно верить как итогу. */
export function isMature(v: LadderVideo, now: Date = new Date()): boolean {
  return !!v.published_at && daysSince(v.published_at, now) >= MATURE_DAYS;
}

/** Вышел, но ещё растёт: младше двух недель. */
export function isYoung(v: LadderVideo, now: Date = new Date()): boolean {
  return !!v.published_at && daysSince(v.published_at, now) < MATURE_DAYS;
}

/**
 * Медиана, а не среднее: один виральный ролик на миллион сдвигает
 * среднее так, что «обычный ролик» перестаёт быть обычным, и все
 * дальнейшие «сколько роликов до ступени» становятся недостижимыми.
 */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * «Типичный ролик» — медиана зрелых роликов автора.
 *
 * СЕЙЧАС НЕ ВЫЗЫВАЕТСЯ: лесенку «свои → медиана проекта → значение по
 * умолчанию» считает сервер и отдаёт готовым числом. Вторая копия правила
 * в браузере разошлась бы с ним на первой же правке, и связать одно с
 * другим было бы некому — по той же причине здесь не выводятся и границы
 * периода. Функция оставлена на случай, когда понадобится посчитать
 * медиану на месте, из своих же данных.
 */
export function typicalVideo(
  own: LadderVideo[],
  projectMedian: number | null = null,
  now: Date = new Date(),
): Typical | null {
  const mine = recentMature(own, now);
  if (mine.length >= MIN_OWN_SAMPLE) {
    const value = median(mine.map((v) => v.views));
    if (value !== null) return { views: value, source: 'creator', sample: mine.length };
  }
  if (projectMedian !== null && projectMedian > 0) {
    return { views: projectMedian, source: 'project', sample: 0 };
  }
  return null;
}

// Последние зрелые ролики, свежие первыми.
function recentMature(own: LadderVideo[], now: Date): LadderVideo[] {
  return own
    .filter((v) => isMature(v, now))
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    .slice(0, TYPICAL_WINDOW);
}

/**
 * «Хит» — лучший зрелый ролик автора, а не выдуманный порог.
 *
 * Хит должен быть узнаваем: человек уже снимал такое, и число на экране
 * — его собственный рекорд, а не константа, которую кто-то однажды
 * вписал. Если рекорд не отличается от обычного ролика хотя бы вдвое,
 * хита нет: «один хит и восемь обычных» про такие числа — не другой
 * план, а тот же самый другими словами.
 */
export function hitVideo(
  own: LadderVideo[],
  typicalViews: number | null,
  now: Date = new Date(),
): number | null {
  if (typicalViews === null || typicalViews <= 0) return null;
  const mature = recentMature(own, now).map((v) => v.views);
  if (!mature.length) return null;
  const best = Math.max(...mature);
  return best >= typicalViews * 2 ? best : null;
}

export interface LadderState {
  /** Просмотры в счёте ступеней — вместе с перенесённым остатком. */
  views: number;
  /** Сколько ступеней пройдено целиком. */
  passed: number;
  /** На каком числе следующая ступень. */
  nextAt: number;
  /** Сколько просмотров до неё. */
  toNext: number;
  /** Доля пройденного внутри текущей ступени, 0..1 — для полосы. */
  progress: number;
}

export function ladderState(views: number): LadderState {
  const safe = Math.max(0, Math.round(views));
  const passed = Math.floor(safe / LADDER_STEP);
  const nextAt = (passed + 1) * LADDER_STEP;
  return {
    views: safe,
    passed,
    nextAt,
    toNext: nextAt - safe,
    progress: (safe % LADDER_STEP) / LADDER_STEP,
  };
}

/**
 * Просмотры короткой строкой: «80 тыс.», «1,2 млн», «12 400».
 *
 * Разряды делим неразрывным пробелом, как и суммы в money.ts: обычный
 * пробел даёт перенос строки посреди числа.
 */
export function shortViews(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1_000_000) {
    const mln = v / 1_000_000;
    const head = mln >= 10 ? String(Math.round(mln)) : String(Math.round(mln * 10) / 10);
    return `${head.replace('.', ',')}\u00a0млн`;
  }
  // Ровные тысячи — «80 тыс.»; неровные показываем целиком, иначе
  // «12 тыс.» вместо 12 400 прячет ровно ту разницу, из-за которой
  // человек и смотрит на число.
  if (v >= 10_000 && v % 1000 === 0) return `${v / 1000}\u00a0тыс.`;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

// ---- что осталось до ступени ----
//
// Одна строка и один ролик. Прежде их было три: «Один ролик на 100 тыс.
// закрывает ступень. Или два по 50 тыс.», потом «Обычными — это 34…»,
// потом «План периода выполнен — новых дат впереди нет. Недобранное до
// ступени не пропадает…». Всё верно и всё вместе — абзац, который читают
// как отчёт о том, чего человек не сделал.
//
// Считаем в роликах, а не в просмотрах: ролики человек снимает, просмотры
// с него не спрашивают. «Один залетевший» — это не фигура речи: по данным
// площадки ролик вдвое-втрое выше обычного бывает у каждого десятого, то
// есть раз в месяц он у автора случается.

/**
 * Что осталось до ступени — одной строкой.
 *
 * Ориентира нет или до ступени дальше трёх обычных роликов — называем
 * число. Обещать «один залетевший» там, где нужен тридцатикратный
 * рекорд, значит соврать бодрым голосом; а «Один ролик на 60 тыс. — и
 * ступень взята» и правда, и по-прежнему про один ролик.
 */
export function stepMotivation(toNext: number, typical: number | null): string {
  if (toNext <= 0) return 'Ступень взята — дальше пошла следующая.';
  if (typical !== null && typical > 0) {
    const videos = toNext / typical;
    if (videos <= 1) return 'До следующей ступени — один обычный ролик.';
    if (videos <= 3) return 'До следующей ступени — один залетевший ролик.';
  }
  return `Один ролик на ${shortViews(toNext)} — и ступень взята.`;
}

/**
 * Вклад одного ролика долей ступени.
 *
 * Ради этого числа всё и затевалось: без него ролик на двадцать тысяч —
 * просто «двадцать тысяч», и непонятно, много это или мало. «Пятая часть
 * ступени» понятно сразу.
 *
 * Мелкие доли не округляем до нуля: «0% ступени» читается как «не дал
 * ничего», а ролик дал ровно столько, сколько дал.
 */
export function stepShareText(views: number, step: number = LADDER_STEP): string {
  if (step <= 0 || views <= 0) return 'пока ничего к ступени';
  const pct = (views / step) * 100;
  if (pct >= 100) {
    const steps = Math.round(pct / 10) / 10;
    // Целое число ступеней склоняем, дробное — нет: «3,2 ступени», но
    // «1 ступень» и «5 ступеней».
    return Number.isInteger(steps)
      ? `${steps} ${plural(steps, 'ступень', 'ступени', 'ступеней')}`
      : `${decimal(steps)} ступени`;
  }
  if (pct >= 10) return `${Math.round(pct)}% ступени`;
  // Меньше десятой процента — «меньше 0,1%»: 0,03 в подписи выглядит
  // опечаткой, а «0%» неправдой.
  if (pct < 0.1) return 'меньше 0,1% ступени';
  return `${decimal(pct)}% ступени`;
}

/** Доля ступени числом 0..1 и выше — для ширины полоски у ролика. */
export function stepShare(views: number, step: number = LADDER_STEP): number {
  if (step <= 0 || views <= 0) return 0;
  return views / step;
}

/** Один знак после запятой, запятой — как принято в русских числах. */
function decimal(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}
