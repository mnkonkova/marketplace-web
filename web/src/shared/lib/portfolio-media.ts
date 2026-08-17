import { PortfolioItem } from '@entities/specialist/model/specialist.types';

/**
 * Ориентация работы. Определяет и aspect-ratio плитки, и раскладку
 * флагмана (вертикаль — плеер на размытой подложке, горизонталь — баннер
 * во всю ширину).
 */
export type Orientation = 'vertical' | 'horizontal' | 'square';

/**
 * Формат, известный из данных: сначала измеренный на бэке aspect, затем
 * размеры первого кадра фото-сета (бэк отдаёт width/height у каждого
 * изображения). null — придётся мерить на клиенте.
 */
export function knownRatio(item: PortfolioItem): number | null {
  const fromAspect = parseAspectRatio(item.aspect);
  if (fromAspect != null) return fromAspect;
  const first = item.images?.[0];
  if (first?.width && first?.height) return first.width / first.height;
  return null;
}

/** Ширина/высота. null — формат неизвестен (нет aspect и не измерили). */
export function parseAspectRatio(aspect?: string): number | null {
  if (!aspect) return null;
  const parts = aspect.split(':').map((p) => parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return parts[0] / parts[1];
}

/**
 * Квадратом считаем полосу 0.9–1.1: 1:1 после кропа редко приходит ровным,
 * а визуально 1.05 от квадрата не отличается.
 */
export function orientationOf(ratio: number | null): Orientation {
  if (ratio == null) return 'vertical';
  if (ratio > 1.1) return 'horizontal';
  if (ratio < 0.9) return 'vertical';
  return 'square';
}

/**
 * Значение для CSS aspect-ratio. Неизвестный формат отдаём как 9/16 —
 * вертикаль в портфолио преобладает, и до loadedmetadata плитка должна
 * занимать место (иначе masonry перекладывается рывком).
 */
export function aspectRatioCss(ratio: number | null): string {
  if (ratio == null) return '9 / 16';
  return `${ratio}`;
}

/**
 * Человеческая метка формата в углу плитки. Считаем от соотношения, а не от
 * строки из БД: измеренный на клиенте формат приходит числом.
 */
export function aspectLabel(ratio: number | null): string {
  if (ratio == null) return '';
  const known: Array<[string, number]> = [
    ['9:16', 9 / 16],
    ['4:5', 4 / 5],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:2', 3 / 2],
    ['16:9', 16 / 9],
    ['2.39:1', 2.39],
  ];
  let best = known[0];
  for (const candidate of known) {
    if (Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio)) best = candidate;
  }
  return best[0];
}

/**
 * Постер плитки. Для photo-set'а — первый кадр (бэк денормализует его в
 * thumbnail_url, но подстраховываемся на случай старых записей).
 *
 * Пусто = постера нет; плитка рендерит <video preload="metadata">, браузер
 * показывает первый кадр сам.
 * TODO(backend): генерировать постер при загрузке (сейчас кадр снимает фронт
 * в portfolio-upload.dialog.ts, и при обрыве аплоада тумбы не остаётся).
 */
export function posterSrc(item: PortfolioItem): string {
  return item.thumbnail_url || item.images?.[0]?.image_url || '';
}

/**
 * Источник для hover-автоплея. Приоритет: animated webp (<img>, не упирается
 * в autoplay-политики и Low Power Mode) → 480p preview → оригинал.
 */
export function hoverPreview(item: PortfolioItem): { kind: 'img' | 'video'; src: string } | null {
  if (item.animated_thumb_url) return { kind: 'img', src: item.animated_thumb_url };
  const video =
    item.preview_status === 'ready' && item.preview_url ? item.preview_url : item.video_url;
  return video ? { kind: 'video', src: video } : null;
}

/** Полноразмерный источник для лайтбокса — всегда оригинал, не 480p. */
export function fullVideoSrc(item: PortfolioItem): string {
  return item.video_url || '';
}

/**
 * Соотношение сторон, измеренное на клиенте, когда бэк не отдал aspect.
 * Возвращает null если размеры ещё не известны.
 */
export function ratioFromElement(el: HTMLVideoElement | HTMLImageElement): number | null {
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return null;
  return w / h;
}
