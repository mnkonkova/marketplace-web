export interface MeProfile {
  updated_at: string;
  user_id: string;
  display_name: string;
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
}

// MeProfileFullPatch — payload для PATCH /me/profile.
// Любая секция опциональна: отсутствует/undefined = не трогать.
// updated_at — общий optimistic-lock; проверяется один раз на всю транзакцию.
export interface MeProfileFullPatch {
  display_name?: string;
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

export interface PortfolioCreateInput {
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  category_codes: string[];
}

export interface PublishErrorBody {
  check?: ProfileCheckResult;
}
