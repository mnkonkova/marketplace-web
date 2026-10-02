import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';

const STORAGE_KEY = 'marketpclce.auth.v1';

/**
 * Сессия без is_manager/is_admin — «права неизвестны». Так её сохранял вход
 * через Яндекс, и админ с менеджером теряли кнопку в свой кабинет: шапка
 * смотрит на флаги, а подтянуть их было некому.
 */
describe('AuthSessionStore: восстановление прав CRM', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  function store(): AuthSessionStore {
    return TestBed.inject(AuthSessionStore);
  }

  it('дочитывает /me, если флагов в сессии нет', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ access_token: 'a', refresh_token: 'r', kind: 'client' }),
    );
    const auth = store();
    // Запрос уходит микротаском — из конструктора он упёрся бы в цикл с
    // auth-интерцептором, который сам инжектит этот стор.
    await Promise.resolve();
    http.expectOne((r) => r.url.endsWith('/me')).flush({ kind: 'client', is_admin: true });
    expect(auth.isAdmin()).toBeTrue();
    expect(auth.role()).toBe('admin');
  });

  it('не ходит в /me, когда сессия полная', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: 'a',
        refresh_token: 'r',
        user_id: 'u1',
        // Имя — тоже часть полной сессии: админская оболочка подписывает
        // им блок пользователя, и без него она не знает, под кем работает.
        display_name: 'Мария',
        kind: 'client',
        is_admin: false,
        is_manager: true,
      }),
    );
    const auth = store();
    await Promise.resolve();
    http.expectNone((r) => r.url.endsWith('/me'));
    expect(auth.role()).toBe('manager');
    expect(auth.userId()).toBe('u1');
  });

  it('дочитывает /me ради user_id, даже если флаги CRM уже есть', async () => {
    // Сессия, сохранённая до появления поля: права известны, а свой id —
    // нет. Без него в переписке не отличить свои сообщения от чужих, и
    // ждать релога ради этого нельзя.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: 'a',
        refresh_token: 'r',
        kind: 'client',
        is_admin: false,
        is_manager: true,
      }),
    );
    const auth = store();
    await Promise.resolve();
    http
      .expectOne((r) => r.url.endsWith('/me'))
      .flush({ user_id: 'u7', kind: 'client', is_manager: true });
    expect(auth.userId()).toBe('u7');
  });

  it('гостя не трогает', async () => {
    const auth = store();
    await Promise.resolve();
    http.expectNone(() => true);
    expect(auth.isLoggedIn()).toBeFalse();
  });
});

/**
 * Билет привязки телеграма гасится и у того, кто УЖЕ вошёл.
 *
 * Раньше он гасился только при записи новой пары токенов, то есть ровно
 * при свежем входе. А самый частый путь другой: человек уже сидит на
 * сайте, открывает мини-апп, жмёт «Войти на сайте» — браузер открывает
 * сайт, где входить уже не надо, токены не перезаписываются, и билет
 * остаётся лежать непогашенным. Сколько раз ни повтори — каждый проход
 * одинаков.
 *
 * Дороже всех это стоило аккаунту из Яндекса: пароля у него нет вовсе,
 * и войти в мини-апп по паролю он не может в принципе — привязка через
 * билет была для него единственным путём.
 */
describe('AuthSessionStore: билет привязки телеграма', () => {
  const TICKET = 'prmarket.tg.claim';
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function loggedIn(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ access_token: 'a', refresh_token: 'r', kind: 'specialist', is_manager: false }),
    );
  }

  it('гасит билет у уже вошедшего — без повторного входа', () => {
    loggedIn();
    sessionStorage.setItem(TICKET, 'CODE-1');

    TestBed.inject(AuthSessionStore).claimTelegram();

    const req = http.expectOne((r) => r.url.endsWith('/me/telegram/claim'));
    expect(req.request.body).toEqual({ code: 'CODE-1' });
    req.flush({});
    // Второй раз не шлём: билет одноразовый, и повтор получил бы отказ.
    expect(sessionStorage.getItem(TICKET)).toBeNull();
  });

  /**
   * У гостя билет остаётся лежать: ручка закрыта авторизацией, и
   * погасить его сейчас значило бы сжечь впустую — второго Telegram не
   * выдаст.
   */
  it('у гостя билет не трогает', () => {
    sessionStorage.setItem(TICKET, 'CODE-2');

    TestBed.inject(AuthSessionStore).claimTelegram();

    http.expectNone((r) => r.url.endsWith('/me/telegram/claim'));
    expect(sessionStorage.getItem(TICKET)).toBe('CODE-2');
  });
});
