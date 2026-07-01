export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  kind?: string;
  is_manager?: boolean;
  is_admin?: boolean;
  is_approved?: boolean;
}

export interface RegisterPayload {
  email?: string;
  phone?: string;
  password: string;
  kind: 'client' | 'specialist';
  display_name: string;
  // source — трэкинг + мягкий шорткат: "landing_clients" разрешает бэку
  // авто-подтвердить email. Юзер регается на /for-clients и сразу идёт
  // в бриф, клик по письму на этом шаге ломает воронку.
  source?: string;
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
  // CRM-флаги. Роль для UI выводится на стороне фронта в auth-session.store
  // (admin > manager > специалист по kind > клиент).
  is_manager: boolean;
  is_admin: boolean;
  is_approved: boolean;
  email_verified: boolean;
}
