export interface SocialLinks {
  telegram?: string;
  whatsapp?: string;
  vk?: string;
  youtube?: string;
  instagram?: string;
  tiktok?: string;
  behance?: string;
  dribbble?: string;
  website?: string;
}

export interface MeProfile {
  updated_at: string;
  user_id: string;
  /** Публичный handle для URL /specialist/<username>. Пусто = не выбрал. */
  username?: string;
  display_name: string;
  social_links?: SocialLinks;
  bio: string;
  avatar_url?: string;
  city?: string;
  rate_min?: number | null;
  rate_max?: number | null;
  currency: string;
  is_published: boolean;
  categories: string[];
  primary_category?: string;
  skill_ids: string[];
  contact_email?: string;
  contact_phone?: string;
  // CRM v5: выбор работодателя (XOR на CHECK в БД). Оба пустые/false =
  // выбор не сделан.
  production_id?: string | null;
  is_freelance: boolean;
  // Модерация публикации админом. В каталоге появляется только
  // is_published && moderation_status === 'approved'. Подробности —
  // marketplace-api/docs/SPECIALIST_MODERATION.md.
  moderation_status: 'pending_review' | 'approved' | 'rejected';
  moderation_reason?: string;
  moderation_reviewed_at?: string;
}

// MeProfileFullPatch — payload для PATCH /me/profile.
// Любая секция опциональна: отсутствует/undefined = не трогать.
// updated_at — общий optimistic-lock; проверяется один раз на всю транзакцию.
export interface MeProfileFullPatch {
  display_name?: string;
  /** Поменять username. "" = сбросить, undefined = не трогать. */
  username?: string;
  bio?: string;
  avatar_url?: string;
  city?: string;
  currency?: string;
  contact_email?: string;
  contact_phone?: string;
  rate_min?: number | null;
  rate_max?: number | null;
  categories?: { codes: string[]; primary: string };
  skills?: { skill_ids: string[] };
  social_links?: SocialLinks;
  updated_at?: string;
  // CRM v5: production_id="uuid" → выбрать; ""=снять; не задано=не трогать.
  // is_freelance=true/false → переключить флаг (сервер автоматом снимет
  // другой выбор по XOR-правилу).
  production_id?: string;
  is_freelance?: boolean;
}

export interface ProfileCheckPart {
  ok: boolean;
  score: number;
  reasons?: string[];
  suggestion?: string;
}

export interface ProfileCheckResult {
  ok: boolean;
  name?: ProfileCheckPart;
  bio?: ProfileCheckPart;
}

export interface UploadURLResponse {
  upload_url: string;
  public_url: string;
  key: string;
  expires_in: number;
}

// === Multipart upload (для крупного видео > 5 МБ) ===

export interface MultipartStartInput {
  filename: string;
  content_type: string;
  size_bytes: number;
}

export interface MultipartStartResponse {
  upload_id: string;
  key: string;
  public_url: string;
  /** размер каждого чанка кроме последнего, в байтах */
  part_size: number;
}

export interface MultipartPartURLInput {
  key: string;
  upload_id: string;
  part_number: number;
}

export interface MultipartPartURLResponse {
  upload_url: string;
  expires_in: number;
}

export interface MultipartPart {
  part_number: number;
  etag: string;
}

export interface MultipartCompleteInput {
  key: string;
  upload_id: string;
  parts: MultipartPart[];
}

export interface MultipartAbortInput {
  key: string;
  upload_id: string;
}

export interface PortfolioCreateInput {
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  category_codes: string[];
  // Form-state категорий профиля. Backend валидирует category_codes против
  // этого списка (если он передан) — нужно для случая когда юзер только
  // зарегистрировался, выбрал категорию в форме, но ещё не нажал
  // «Сохранить», и сразу пытается загрузить видео.
  profile_categories?: string[];
}

export interface PortfolioPhotoRef {
  image_url: string;
  width?: number;
  height?: number;
}

export interface PortfolioPhotoSetCreateInput {
  title: string;
  description?: string;
  category_codes?: string[];
  profile_categories?: string[];
  images: PortfolioPhotoRef[];
}

export interface PublishErrorBody {
  check?: ProfileCheckResult;
}
