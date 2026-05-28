export interface SpecialistLite {
  user_id: string;
  display_name: string;
  bio?: string;
  avatar_url?: string;
  city?: string;
  categories?: string[];
  primary_category?: string;
  rate_min?: number | null;
  rate_max?: number | null;
  currency?: string;
  rating_avg?: number;
  reviews_count?: number;
}

export interface CategoryRef {
  code: string;
  title: string;
  is_primary: boolean;
}

export interface SkillRef {
  id: string;
  slug: string;
  title: string;
  kind: string;
}

export interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  video_url?: string;
  thumbnail_url?: string;
  external_url?: string;
  category_codes: string[];
  sort_order: number;
  created_at: string;
}

export interface ReviewItem {
  id: string;
  author_name: string;
  rating: number;
  text: string;
  created_at: string;
}

export interface SpecialistProfile extends Omit<SpecialistLite, 'categories'> {
  categories: CategoryRef[];
  skills: SkillRef[];
  portfolio: PortfolioItem[];
  reviews: ReviewItem[];
}

export interface SearchHit extends SpecialistLite {
  skill_slugs?: string[];
  skill_titles?: string;
  is_published?: boolean;
  updated_at?: string;
}

export interface SearchResult {
  total: number;
  items: SearchHit[];
  similar?: SearchHit[];
  relaxed?: string[];
  broadened?: boolean;
  facets?: {
    categories?: Array<{ code: string; count: number }>;
  };
}

export interface SearchParams {
  q?: string;
  categories?: string[];
  skills?: string[];
  city?: string;
  rate_min?: number;
  rate_max?: number;
  limit?: number;
  offset?: number;
}

export interface ClarifyMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClarifySearchParams {
  q?: string;
  categories?: string[];
  skills?: string[];
  city?: string;
  rate_min?: number;
  rate_max?: number;
}

export interface ClarifyResponse {
  message: string;
  done: boolean;
  search?: ClarifySearchParams;
}

export interface SummarizePick {
  user_id: string;
  rank: number;
  reason: string;
  profile: SearchHit;
}

export interface SummarizeResult {
  summary: string;
  picks: SummarizePick[];
  broadened?: boolean;
  target_category?: string;
  total_in_category?: number;
  cached?: boolean;
}
