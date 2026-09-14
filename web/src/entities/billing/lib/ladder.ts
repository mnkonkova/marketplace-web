// Шкала прогресса креатора: ступени по просмотрам.
//
// Всё здесь — чистые функции над числами, и это намеренно. Считать
// «сколько роликов до ступени» внутри компонента значит проверять
// арифметику через вёрстку: тест на медиану превращается в тест на то,
// что в карточке нужный <b>. Компонент только раскладывает по экрану то,
// что посчитано тут.
//
// Денег здесь нет ни в каком виде. Сколько заработано за период, знает
// сервер — оно берётся из начисления как есть. Второй расчёт в браузере
// разойдётся с серверным на первой же правке тарифа, и разойдётся молча.

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

/** Откуда взялся «типичный ролик»: это видно на экране. */
export type TypicalSource = 'own' | 'project';

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
 * Своих меньше десяти — считаем по проекту: чужая медиана хуже своей, но
 * лучше медианы трёх роликов. Нет и проектной — возвращаем null, и экран
 * говорит «пока не на чем считать». Подставить сюда придуманное число
 * значит построить на нём весь дальнейший план: и «сколько роликов до
 * ступени», и прогноз.
 */
export function typicalVideo(
  own: LadderVideo[],
  projectMedian: number | null = null,
  now: Date = new Date(),
): Typical | null {
  const mine = recentMature(own, now);
  if (mine.length >= MIN_OWN_SAMPLE) {
    const value = median(mine.map((v) => v.views));
    if (value !== null) return { views: value, source: 'own', sample: mine.length };
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
  typical: Typical | null,
  now: Date = new Date(),
): number | null {
  if (!typical || typical.views <= 0) return null;
  const mature = recentMature(own, now).map((v) => v.views);
  if (!mature.length) return null;
  const best = Math.max(...mature);
  return best >= typical.views * 2 ? best : null;
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
 * Ступени для отрисовки: пройденные, текущая и следующая.
 *
 * Показываем не всю бесконечную шкалу, а окно вокруг текущего
 * положения: три пройденные ступени назад и следующую вперёд. Полная
 * шкала на седьмой ступени превращается в ленту одинаковых галочек.
 */
export function ladderMarks(state: LadderState, back = 3): number[] {
  const first = Math.max(1, state.passed - back + 1);
  const marks: number[] = [];
  for (let i = first; i <= state.passed + 1; i += 1) marks.push(i * LADDER_STEP);
  return marks;
}

export interface VideoPlan {
  /** Обычными роликами: «это 20 обычных роликов». */
  normal: number;
  /**
   * Сколько обычных нужно ДОПОЛНИТЕЛЬНО к одному хиту. 0 — хит закрывает
   * ступень сам. null — варианта с хитом нет: своего рекорда ещё нет или
   * он неотличим от обычного ролика.
   */
  withHit: number | null;
}

/** «20 обычных роликов или 1 хит и 8 обычных». */
export function videosToStep(
  toNext: number,
  typical: number,
  hit: number | null = null,
): VideoPlan {
  if (toNext <= 0 || typical <= 0) return { normal: 0, withHit: null };
  const normal = Math.ceil(toNext / typical);
  if (hit === null || hit < typical * 2) return { normal, withHit: null };
  return { normal, withHit: Math.max(0, Math.ceil((toNext - hit) / typical)) };
}

export interface ForecastInput {
  /** Просмотры в счёте ступеней сейчас, вместе с перенесённым остатком. */
  current: number;
  /** Просмотры роликов, которые вышли, но ещё растут. */
  young: number[];
  typical: number;
  /** Сколько роликов по плану ещё выйдет до конца периода. */
  plannedLeft: number;
}

/**
 * Прогноз на конец периода.
 *
 * Три слагаемых: что уже есть, дорост молодых роликов и то, что принесут
 * ещё не вышедшие. Дорост считаем до типичного и не ниже нуля: ролик,
 * который уже перерос типичный, в прогнозе не отнимает — он просто
 * перестаёт расти по этой модели, а не начинает терять просмотры.
 */
export function forecastViews(input: ForecastInput): number {
  const { current, young, typical, plannedLeft } = input;
  const growth = young.reduce((sum, v) => sum + Math.max(0, typical - v), 0);
  return Math.round(current + growth + Math.max(0, plannedLeft) * Math.max(0, typical));
}

/** До какой отметки не дотянул этот конкретный ролик. */
export type VideoLevel = 'typical' | 'best' | 'top';

export interface VideoTarget {
  level: VideoLevel;
  /** Сколько просмотров осталось до отметки. 0 — отметка взята. */
  left: number;
}

/**
 * Куда тянуть конкретный ролик: до типичного, потом до своего рекорда.
 *
 * Отметки — собственные числа автора, а не шкала «хороший / отличный»
 * с выдуманными порогами: «до отличного 2 600» звучит убедительно ровно
 * до вопроса, откуда взялось «отличное».
 */
export function videoTarget(
  views: number,
  typical: number,
  hit: number | null = null,
): VideoTarget | null {
  if (typical <= 0) return null;
  if (views < typical) return { level: 'typical', left: typical - views };
  if (hit !== null && views < hit) return { level: 'best', left: hit - views };
  return { level: 'top', left: 0 };
}

/** Лучшие ролики периода — чтобы было видно, что повторять. */
export function bestVideos(videos: LadderVideo[], limit = 3): LadderVideo[] {
  return [...videos]
    .filter((v) => !!v.published_at && v.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
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
