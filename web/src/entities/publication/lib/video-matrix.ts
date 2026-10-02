import {
  ALL_PLATFORMS,
  Platform,
  Publication,
  VideoRow,
} from '@entities/publication/model/publication.types';

// Таблица «ролик × площадка» для менеджера.
//
// Строка — выкладка, колонка — площадка, клетка — одна ссылка. Источник
// цифр — videos_table отчёта (строка на каждую сданную ссылку), а
// названия и порядок — список выкладок: в отчёте их нет.
//
// У клетки четыре состояния, и ни одно из них не ноль:
//   none    — ссылки нет, считать нечего;
//   pending — ссылка сдана, а сборщик по ней ещё не приходил;
//   failed  — сборщик приходил и отказал (площадка не собирается, ролик
//             удалён) — это наша работа, а не креатора;
//   ok      — есть снимок.
// Ноль означал бы «ролик вышел, и его никто не посмотрел» — другое
// утверждение, и такие подмены здесь уже стоили разборов.

export type MatrixMetric = 'views' | 'growth' | 'er';

export type MatrixCell =
  | { kind: 'none' }
  | { kind: 'pending'; url: string }
  // reason — исходный текст сборщика, для подсказки; подпись для глаз
  // делает collectErrorLabel.
  | { kind: 'failed'; url: string; reason: string }
  | {
      kind: 'ok';
      url: string;
      views: number;
      growth: number | null;
      er: number | null;
      // ER посчитан без репостов — площадка их не отдала. Число занижено,
      // и менеджер обязан это видеть: по нему он объясняет цифры заказчику.
      erPartial: boolean;
    };

export interface MatrixVideo {
  publicationId: string;
  title: string;
  // Чей ролик. Пусто у проекта без креаторов — там ролики бренда.
  creatorUserId: string;
  creatorName?: string;
  // Дата для подписи: когда вышел, а если площадки её не отдали — срок.
  date: string;
  cells: Record<Platform, MatrixCell>;
  views: number;
  growth: number | null;
  er: number | null;
  erPartial: boolean;
  // Сколько клеток реально замерено. Ноль при непустых links означает
  // «ссылки есть, а чисел нет» — показывать такой итог нулём нельзя по
  // той же причине, по которой нулём не показывают клетку.
  measured: number;
  // Площадки без ссылки — для «напомнить» на телефоне.
  missing: Platform[];
}

export interface PlatformTotal {
  platform: Platform;
  views: number;
  growth: number | null;
  er: number | null;
  erPartial: boolean;
  links: number;
  // Из links — сколько со снимком. Площадка, где сборщик отказал по
  // всем ссылкам, даёт links=3 и measured=0: сумма по ней НЕ ноль, она
  // неизвестна.
  measured: number;
}

export interface MatrixTotals {
  totals: PlatformTotal[];
  views: number;
  growth: number | null;
  er: number | null;
  erPartial: boolean;
  measured: number;
}

export interface VideoMatrix extends MatrixTotals {
  videos: MatrixVideo[];
}

/**
 * Накопитель итога по набору клеток.
 *
 * Прирост — null, если хоть у одной клетки его нет: сложить известное с
 * неизвестным и выдать за полное число — то же занижение, только
 * спрятанное (правило отчёта, growth_24h в PublicationReport).
 *
 * ER — средневзвешенный по просмотрам: ролик в сто просмотров с ER 20 %
 * не должен тянуть итог так же, как ролик в миллион.
 */
class Sum {
  public views = 0;
  public growth: number | null = 0;
  public links = 0;
  // Сколько клеток дали число. Отличать от links обязательно: иначе
  // пять отказов сборщика складываются в честный на вид ноль.
  public measured = 0;
  // Хоть одна вошедшая в ER клетка — без репостов: итог занижен тоже.
  public erPartial = false;
  private erWeighted = 0;
  private erViews = 0;

  public add(c: MatrixCell): void {
    if (c.kind === 'none') return;
    this.links++;
    if (c.kind !== 'ok') return;
    this.measured++;
    this.views += c.views;
    if (c.growth === null) this.growth = null;
    else if (this.growth !== null) this.growth += c.growth;
    if (c.er !== null && c.views > 0) {
      this.erWeighted += c.er * c.views;
      this.erViews += c.views;
      if (c.erPartial) this.erPartial = true;
    }
  }

  public get er(): number | null {
    return this.erViews > 0 ? this.erWeighted / this.erViews : null;
  }
}

function emptyCells(): Record<Platform, MatrixCell> {
  const out = {} as Record<Platform, MatrixCell>;
  for (const p of ALL_PLATFORMS) out[p] = { kind: 'none' };
  return out;
}

function toCell(r: VideoRow): MatrixCell {
  // Нет снимка: либо сборщик отказал (причина записана), либо ещё не
  // приходил. Нули в строке отчёта тут ничего не значат — это COALESCE
  // на стороне сервера.
  if (!r.collected_at) {
    return r.collect_error
      ? { kind: 'failed', url: r.url, reason: r.collect_error }
      : { kind: 'pending', url: r.url };
  }
  return {
    kind: 'ok',
    url: r.url,
    views: r.views,
    growth: r.growth_24h,
    er: r.er_percent ?? null,
    erPartial: !!r.er_without_shares,
  };
}

/**
 * Номер выкладки — тот же, что в плане: по сроку, внутри дня по слоту.
 * Отменённые не нумеруются — их нет в плане.
 */
function numbering(pubs: Publication[]): Map<string, number> {
  const live = pubs
    .filter((p) => p.status !== 'cancelled')
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.day_slot ?? 1) - (b.day_slot ?? 1));
  return new Map(live.map((p, i) => [p.id, i + 1]));
}

/** Сегодня в виде ГГГГ-ММ-ДД по местному времени — сравнивать со сроком. */
function todayKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildVideoMatrix(
  pubs: Publication[],
  rows: VideoRow[],
  today: string = todayKey(),
): VideoMatrix {
  const no = numbering(pubs);
  const byPub = new Map<string, VideoRow[]>();
  for (const r of rows) {
    const list = byPub.get(r.publication_id) ?? [];
    list.push(r);
    byPub.set(r.publication_id, list);
  }

  const videos: MatrixVideo[] = [];
  for (const p of pubs) {
    const n = no.get(p.id);
    const own = byPub.get(p.id);
    if (n === undefined) continue;
    // Без единой ссылки ролик здесь, только если его срок уже наступил:
    // он должен был выйти, и ссылку ему ставят (у проекта без креаторов
    // — менеджер) или о ней напоминают. Будущим место в плане: таблица,
    // где половина строк пустые, перестаёт отвечать про вышедшее.
    if (!own?.length && p.due_date.slice(0, 10) > today) continue;

    const cells = emptyCells();
    for (const r of own ?? []) cells[r.platform] = toCell(r);

    const sum = new Sum();
    for (const pl of ALL_PLATFORMS) sum.add(cells[pl]);

    videos.push({
      publicationId: p.id,
      title: p.title || `Выкладка ${String(n).padStart(2, '0')}`,
      creatorUserId: p.creator_user_id ?? '',
      creatorName: p.creator_name || own?.[0]?.creator_name,
      date: p.published_at ?? p.due_date,
      cells,
      views: sum.views,
      growth: sum.growth,
      er: sum.er,
      erPartial: sum.erPartial,
      measured: sum.measured,
      missing: ALL_PLATFORMS.filter((pl) => cells[pl].kind === 'none'),
    });
  }

  // Новые сверху: менеджер открывает таблицу спросить про вчерашний ролик.
  videos.sort((a, b) => b.date.localeCompare(a.date));

  return { videos, ...summarize(videos) };
}

/**
 * Итоги по набору роликов: по каждой площадке и всего.
 *
 * Отдельно от сборки таблицы, потому что итогов нужно несколько: по
 * всему проекту и по каждому креатору. Номера выкладок при этом считает
 * сборка по всему плану — отфильтрованный набор их не переписывает.
 */
export function summarize(videos: readonly MatrixVideo[]): MatrixTotals {
  const total = new Sum();
  const perPlatform = new Map<Platform, Sum>(ALL_PLATFORMS.map((p) => [p, new Sum()]));
  for (const v of videos) {
    for (const pl of ALL_PLATFORMS) {
      total.add(v.cells[pl]);
      perPlatform.get(pl)!.add(v.cells[pl]);
    }
  }
  return {
    totals: ALL_PLATFORMS.map((platform) => {
      const s = perPlatform.get(platform)!;
      return {
        platform,
        views: s.views,
        growth: s.growth,
        er: s.er,
        erPartial: s.erPartial,
        links: s.links,
        measured: s.measured,
      };
    }),
    views: total.views,
    growth: total.growth,
    er: total.er,
    erPartial: total.erPartial,
    measured: total.measured,
  };
}

/** Значение клетки по выбранной метрике; null — числа нет. */
export function cellValue(c: MatrixCell, metric: MatrixMetric): number | null {
  if (c.kind !== 'ok') return null;
  if (metric === 'views') return c.views;
  if (metric === 'growth') return c.growth;
  return c.er;
}

/** Наибольшее значение метрики среди клеток — шкала насыщенности. */
export function matrixMax(m: { videos: readonly MatrixVideo[] }, metric: MatrixMetric): number {
  let max = 0;
  for (const v of m.videos) {
    for (const pl of ALL_PLATFORMS) {
      const x = cellValue(v.cells[pl], metric);
      if (x !== null && x > max) max = x;
    }
  }
  return max;
}

/**
 * Насыщенность клетки, 0…1.
 *
 * Корень, а не линейная доля: просмотры площадок различаются на порядки,
 * и в линейной шкале всё, кроме TikTok-хита, сливалось бы в один бледный
 * цвет — таблица переставала бы отвечать, где ещё набирают.
 */
export function heat(value: number | null, max: number): number {
  if (value === null || value <= 0 || max <= 0) return 0;
  return Math.sqrt(Math.min(value, max) / max);
}
