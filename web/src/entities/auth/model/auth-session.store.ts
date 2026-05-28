import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { API_URL } from '@shared/api/api-url.token';
import { AuthSession, LoginPayload, RegisterPayload, TokenPair } from './auth.types';

const STORAGE_KEY = 'marketpclce.auth.v1';

@Injectable({ providedIn: 'root' })
export class AuthSessionStore {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  private readonly cart = inject(ProjectCartStore);

  private readonly session = signal<AuthSession | null>(this.read());

  public readonly isLoggedIn = computed(() => !!this.session()?.access_token);

  public readonly kind = computed(() => this.session()?.kind ?? '');

  public accessToken(): string {
    return this.session()?.access_token ?? '';
  }

  public refreshToken(): string {
    return this.session()?.refresh_token ?? '';
  }

  public save(pair: TokenPair, kind?: string): void {
    const next: AuthSession = {
      access_token: pair.access_token,
      refresh_token: pair.refresh_token,
      kind: kind ?? this.session()?.kind,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.session.set(next);
  }

  public clear(): void {
    this.session.set(null);
    this.cart.resetMemory();
    localStorage.clear();
    sessionStorage.clear();
  }

  public register(payload: RegisterPayload): Observable<{ user_id: string; tokens: TokenPair }> {
    return this.http
      .post<{ user_id: string; tokens: TokenPair }>(`${this.api}/auth/register`, payload)
      .pipe(tap((res) => this.save(res.tokens, payload.kind)));
  }

  public login(payload: LoginPayload, kind?: string): Observable<TokenPair> {
    return this.http
      .post<TokenPair>(`${this.api}/auth/login`, payload)
      .pipe(tap((pair) => this.save(pair, kind)));
  }

  public refresh(): Observable<TokenPair> {
    return this.http
      .post<TokenPair>(`${this.api}/auth/refresh`, {
        refresh_token: this.refreshToken(),
      })
      .pipe(tap((pair) => this.save(pair)));
  }

  private read(): AuthSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as AuthSession;
      if (!p?.access_token || !p?.refresh_token) return null;
      return p;
    } catch {
      return null;
    }
  }
}
