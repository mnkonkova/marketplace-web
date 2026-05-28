import { SpecialistLite } from '@entities/specialist/model/specialist.types';

export interface FeedVideo {
  id: string;
  url: string;
  thumb?: string;
  title?: string;
  description?: string;
  duration_sec?: number;
  aspect?: string;
  created_at: string;
}

export interface FeedItem {
  video: FeedVideo;
  specialist: SpecialistLite & {
    categories: string[];
    primary_category?: string;
    rating_avg: number;
    reviews_count: number;
  };
  video_idx: number;
  video_total: number;
}

export interface FeedResponse {
  items: FeedItem[];
  next_cursor?: string;
  /** Роликов осталось в ленте (включая items текущего ответа). */
  total?: number;
}

export interface FeedParams {
  q?: string;
  categories?: string[];
  skills?: string[];
  city?: string;
  cursor?: string;
}
