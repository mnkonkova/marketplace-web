export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  kind?: string;
}

export interface RegisterPayload {
  email?: string;
  phone?: string;
  password: string;
  kind: 'client' | 'specialist' | 'both';
  display_name: string;
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
}
