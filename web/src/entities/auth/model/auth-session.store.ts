import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { API_URL } from '@shared/api/api-url.token';
import { AuthSession, LoginPayload, MeUser, RegisterPayload, TokenPair } from './auth.types';

const STORAGE_KEY = 'marketpclce.auth.v1';

@Injectable({ providedIn: 'root' })
export class AuthSessionStore {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  private readonly cart = inject(ProjectCartStore);

  private readonly session = signal<AuthSession | null>(this.read());

  public readonly isLoggedIn = computed(() => !!this.session()?.access_token);

  public readonly kind = computed(() => this.session()?.kind ?? '');

  // CRM v5: роль определяет какие кабинеты доступны и куда редиректить
  // после логина. Подтягивается из /me, поэтому может быть пустой если
  // юзер ещё не открыл страницу с подгрузкой /me.
  public readonly role = computed(() => this.session()?.role ?? '');

  public readonly isApproved = computed(() => this.session()?.is_approved ?? true);

  public accessToken(): string {
    return this.session()?.access_token ?? '';
  }

  public refreshToken(): string {
    return this.session()?.refresh_token ?? '';
  }

  public save(pair: TokenPair, kind?: string): void {
    const prev = this.session();
    const next: AuthSession = {
      access_token: pair.access_token,
      refresh_token: pair.refresh_token,
      kind: kind ?? prev?.kind,
      role: prev?.role,
      is_approved: prev?.is_approved,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.session.set(next);
  }

  // fetchMe — подгрузить /me и сохранить role/is_approved/kind в сессию.
  // Зовётся из guard/layout-ов после логина, чтобы знать куда направить юзера.
  public fetchMe(): Observable<MeUser> {
    return this.http.get<MeUser>(`${this.api}/me`).pipe(
      tap((u) => {
        const prev = this.session();
        if (!prev) return;
        const next: AuthSession = {
          ...prev,
          kind: u.kind || prev.kind,
          role: u.role,
          is_approved: u.is_approved,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        this.session.set(next);
      }),
    );
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
      .pipe(
        tap((res) => {
          this.save(res.tokens, payload.kind);
          // Подтянуть role/is_approved сразу после регистрации, чтобы
          // шапка показала правильные пункты без релога.
          this.fetchMe().subscribe();
        }),
      );
  }

  public login(payload: LoginPayload, kind?: string): Observable<TokenPair> {
    return this.http
      .post<TokenPair>(`${this.api}/auth/login`, payload)
      .pipe(
        tap((pair) => {
          this.save(pair, kind);
          this.fetchMe().subscribe();
        }),
      );
  }

  public refresh(): Observable<TokenPair> {
    return this.http
      .post<TokenPair>(`${this.api}/auth/refresh`, {
        refresh_token: this.refreshToken(),
      })
      .pipe(tap((pair) => this.save(pair)));
  }

  // verifyEmail — обмен raw-токена из ссылки в письме на новую пару токенов.
  // Сохраняем их в localStorage сразу: после verify юзер логинится этим же
  // действием, чтобы не просить ещё раз ввести пароль.
  public verifyEmail(token: string): Observable<TokenPair> {
    return this.http
      .post<TokenPair>(`${this.api}/auth/verify-email`, { token })
      .pipe(tap((pair) => this.save(pair)));
  }

  public resendVerification(): Observable<void> {
    return this.http.post<void>(`${this.api}/auth/resend-verification`, {});
  }

  // requestPasswordReset — попросить ссылку сброса по email. Бэк всегда
  // отвечает 204 (anti-enumeration); фронт показывает один и тот же тост
  // независимо от того, есть юзер или нет.
  public requestPasswordReset(email: string): Observable<void> {
    return this.http.post<void>(`${this.api}/auth/password-reset/request`, { email });
  }

  // confirmPasswordReset — применить новый пароль по токену из письма.
  // Бэк возвращает свежую пару токенов — сразу сохраняем сессию, чтобы
  // юзер был залогинен без повторного ввода.
  public confirmPasswordReset(token: string, password: string): Observable<TokenPair> {
    return this.http
      .post<TokenPair>(`${this.api}/auth/password-reset/confirm`, { token, password })
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
