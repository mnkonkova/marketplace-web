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

  it('не ходит в /me, когда флаги уже есть', async () => {
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
    http.expectNone((r) => r.url.endsWith('/me'));
    expect(auth.role()).toBe('manager');
  });

  it('гостя не трогает', async () => {
    const auth = store();
    await Promise.resolve();
    http.expectNone(() => true);
    expect(auth.isLoggedIn()).toBeFalse();
  });
});
