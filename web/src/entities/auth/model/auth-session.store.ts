import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map } from 'rxjs';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { API_URL } from '@shared/api/api-url.token';
import { clearTelegramTicket, pendingTelegramTicket } from '@shared/lib/telegram-claim';
import { AuthSession, LoginPayload, MeUser, RegisterPayload, TokenPair } from './auth.types';

const STORAGE_KEY = 'marketpclce.auth.v1';

@Injectable({ providedIn: 'root' })
export class AuthSessionStore {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  private readonly cart = inject(ProjectCartStore);

  private readonly session = signal<AuthSession | null>(this.read());

  public constructor() {
    // Сессия без флагов CRM — это «права неизвестны», а не «прав нет».
    // Так выглядел вход через Яндекс: токены сохранены, is_manager/is_admin
    // никто не подтянул, и у админа с менеджером пропадала кнопка в свой
    // кабинет до следующего входа паролем. Дочитываем один раз на старте.
    const s = this.session();
    if (s?.access_token && (s.is_admin === undefined || !s.user_id || !s.display_name)) {
      // Через микротаск, а не сразу: auth-интерцептор сам инжектит этот
      // стор, и запрос из конструктора упирается в циклическую зависимость
      // — Angular бросает, ошибка гасится, запрос не уходит. К моменту
      // микротаска инстанс уже зарегистрирован в инжекторе.
      queueMicrotask(() => this.fetchMe().subscribe({ error: () => undefined }));
    }
  }

  public readonly isLoggedIn = computed(() => !!this.session()?.access_token);

  public readonly kind = computed(() => this.session()?.kind ?? '');

  // Свой user_id. Пустая строка, пока /me не ответил: у сессии, сохранённой
  // до появления поля, его нет — и подпись «Вы» просто не появится.
  public readonly userId = computed(() => this.session()?.user_id ?? '');

  // Имя для подписи «под кем работаю». Пустая строка, пока /me не ответил.
  public readonly displayName = computed(() => this.session()?.display_name ?? '');

  public readonly isManager = computed(() => this.session()?.is_manager ?? false);

  public readonly isAdmin = computed(() => this.session()?.is_admin ?? false);

  /**
   * ВСЕ роли человека сразу — они друг друга не исключают.
   *
   * Менеджер бывает и креатором: он ведёт чужие проекты и сам снимает в
   * своих. Клиент бывает специалистом (kind = 'both'). Одна строка
   * role() отвечает на вопрос «кто он главным образом», и для выбора
   * заголовка этого хватает — но не для доступа: по ней менеджер-креатор
   * не попадал в собственный кабинет выкладок, потому что «менеджер»
   * перекрывал «специалиста».
   *
   * Пустой массив, пока сессия не загружена: это «ещё не знаем», а не
   * «никто», и guard в этом случае идёт за /me.
   */
  public readonly roles = computed<string[]>(() => {
    const s = this.session();
    if (!s) return [];
    const out: string[] = [];
    if (s.is_admin) out.push('admin');
    if (s.is_manager) out.push('manager');
    if (s.kind === 'specialist' || s.kind === 'both') out.push('specialist');
    // Клиентом человек остаётся всегда, кроме чистого специалиста: заказ
    // под ключ может оформить и менеджер, и админ.
    if (s.kind !== 'specialist') out.push('client');
    return out;
  });

  /** Есть ли у человека такая роль. Для доступа — только это, не role(). */
  public hasRole(...roles: string[]): boolean {
    const mine = this.roles();
    return roles.some((r) => mine.includes(r));
  }

  // CRM-роль для UI — derived. Приоритет: admin > manager > специалист по kind
  // > клиент. Отвечает на вопрос «кем он здесь главным образом», и годится
  // для заголовков и умолчаний. Для ДОСТУПА её мало: см. roles().
  public readonly role = computed(() => {
    const s = this.session();
    if (!s) return '';
    if (s.is_admin) return 'admin';
    if (s.is_manager) return 'manager';
    if (s.kind === 'specialist') return 'specialist';
    return 'client';
  });

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
      is_manager: prev?.is_manager,
      is_admin: prev?.is_admin,
      is_approved: prev?.is_approved,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.session.set(next);
    this.claimTelegram();
  }

  /**
   * Погасить билет привязки телеграма, если он приехал в адресе.
   *
   * Здесь, а не на экране регистрации: аккаунт заводят по-разному —
   * формой, через Яндекс, по ссылке-приглашению, — и ловить каждый
   * путь отдельно значит однажды пропустить. Сессия появилась ровно в
   * одном месте, в save.
   *
   * Молча и без ретраев: привязка не случилась — человек нажмёт
   * кнопку в проекте, и это рабочий путь, а не поломка. Кричать о ней
   * посреди регистрации — пугать на ровном месте.
   */
  public claimTelegram(): void {
    const code = pendingTelegramTicket();
    if (!code) return;
    // Гасим только при живой сессии: ручка закрыта авторизацией, и без
    // неё билет сгорел бы впустую — второго Telegram не выдаст.
    if (!this.session()) return;
    clearTelegramTicket();
    this.http.post(`${this.api}/me/telegram/claim`, { code }).subscribe({
      error: () => undefined,
    });
  }

  // fetchMe — подгрузить /me и сохранить флаги CRM + kind в сессию.
  // Зовётся из guard/layout-ов после логина, чтобы шапка/гарды знали,
  // куда пускать юзера.
  public fetchMe(): Observable<MeUser> {
    return this.http.get<MeUser>(`${this.api}/me`).pipe(
      tap((u) => {
        const prev = this.session();
        if (!prev) return;
        const next: AuthSession = {
          ...prev,
          user_id: u.user_id || prev.user_id,
          display_name: u.display_name || prev.display_name,
          kind: u.kind || prev.kind,
          is_manager: u.is_manager,
          is_admin: u.is_admin,
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

  /**
   * Свободен ли email. Нужен мастеру: регистрация происходит на шаг позже
   * ввода почты, и без этой проверки человек узнавал о занятом адресе,
   * заполнив половину анкеты.
   */
  public emailAvailable(email: string): Observable<boolean> {
    return this.http
      .get<{ available: boolean }>(`${this.api}/auth/email-available`, {
        params: { email },
      })
      .pipe(map((r) => r.available));
  }

  /**
   * Вход и регистрация через Яндекс одной ручкой: человек не должен помнить,
   * заводил ли он здесь аккаунт. На сервер уходит одноразовый код из
   * redirect'а — обмен на токен делает бэкенд, client_secret на клиент не
   * попадает.
   */
  public loginWithYandex(
    code: string,
    kind: 'client' | 'specialist',
  ): Observable<{ isNew: boolean; kind: 'client' | 'specialist' }> {
    return this.http
      .post<{
        user_id: string;
        tokens: TokenPair;
        is_new?: boolean;
        kind?: string;
      }>(`${this.api}/auth/yandex`, { code, kind })
      .pipe(
        map((res) => {
          // Роль берём из ответа: у существующего аккаунта она своя, и
          // запрошенная фронтом её не отменяет. Сохраняем именно настоящую —
          // иначе шапка покажет не тот кабинет.
          const real = (res.kind === 'specialist' ? 'specialist' : 'client') as
            | 'client'
            | 'specialist';
          this.save(res.tokens, real);
          // Как и в login(): без этого шапка не знает про права CRM.
          this.fetchMe().subscribe({ error: () => undefined });
          return { isNew: !!res.is_new, kind: real };
        }),
      );
  }

  /**
   * Вход из мини-аппа Telegram.
   *
   * Подпись проверяет сервер нашим же токеном бота — строку отдаём
   * СЫРОЙ, как её дал Telegram. Три сценария одной ручкой: знакомый
   * телеграм (вход), login+password («у меня уже есть аккаунт») и
   * create=true («я новый»). Без последних двух незнакомый телеграм
   * получает 404 — молча заводить человеку второй аккаунт нельзя, у
   * него уже может быть наш с проектами.
   */
  public loginWithTelegram(payload: {
    bot: 'creator' | 'client';
    init_data: string;
    create?: boolean;
    login?: string;
    password?: string;
  }): Observable<{ isNew: boolean; kind: string }> {
    return this.http
      .post<{
        user_id: string;
        tokens: TokenPair;
        is_new?: boolean;
        kind?: string;
      }>(`${this.api}/auth/telegram/miniapp`, payload)
      .pipe(
        map((res) => {
          // Роль берём из ответа: у существующего аккаунта она своя, и
          // бот, в который человек написал, её не отменяет.
          this.save(res.tokens, res.kind);
          this.fetchMe().subscribe({ error: () => undefined });
          return { isNew: !!res.is_new, kind: res.kind ?? '' };
        }),
      );
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
    return this.http.post<TokenPair>(`${this.api}/auth/login`, payload).pipe(
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
  //
  // fetchMe вызываем как в register/login — иначе session не знает kind/
  // is_manager/is_admin/is_approved, role()='' и кабинет рендерит пустоту
  // при переходе с verify-страницы (особенно если письмо открыли в другом
  // браузере где localStorage пуст).
  public verifyEmail(token: string): Observable<TokenPair> {
    return this.http.post<TokenPair>(`${this.api}/auth/verify-email`, { token }).pipe(
      tap((pair) => {
        this.save(pair);
        this.fetchMe().subscribe();
      }),
    );
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
