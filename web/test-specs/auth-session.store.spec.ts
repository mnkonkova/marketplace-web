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
