import type { FeedVideo } from '../model/feed.types';

/**
 * Источник для autoplay-карточки в фиде/featured-блоке.
 *
 * Возвращает `preview_url` если воркер уже сгенерил облегчённое
 * 480p ~500KB видео, иначе — `url` (оригинал, до 30 МБ).
 *
 * Используй везде, где видео крутится в loop без controls:
 *   <video [src]="feedVideoPreviewSrc(item.video)" autoplay muted loop>
 *
 * Для «развернуть» и полноценного плеера всегда бери `video.url`.
 */
export function feedVideoPreviewSrc(video: FeedVideo): string {
  return video.preview_url || video.url;
}
