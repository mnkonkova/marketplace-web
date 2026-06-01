export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  kind?: string;
  role?: string;
  is_approved?: boolean;
}

export interface RegisterPayload {
  email?: string;
  phone?: string;
  password: string;
  kind: 'client' | 'specialist' | 'both';
  display_name: string;
  // CRM v5: опциональная роль. Пусто/опущено → client. admin через
  // register нельзя (backend отвергает).
  role?: 'client' | 'specialist' | 'manager';
}

export interface LoginPayload {
  login: string;
  password: string;
}

export interface MeUser {
  user_id: string;
  email?: string | null;
  phone?: string | null;
  kind: string;
  role: string;
  is_approved: boolean;
  email_verified: boolean;
}
