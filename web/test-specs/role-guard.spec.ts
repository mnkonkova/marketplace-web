import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { requireRole } from '@shared/guards/role.guard';

const STORAGE_KEY = 'marketpclce.auth.v1';

/**
 * Гард на /me. Проверяем ровно то место, где он раньше ошибался: сессия есть,
 * а роль ещё не приехала. role() в этом случае отдаёт 'client' по умолчанию,
 * и специалиста нельзя разворачивать на основании этой заглушки.
 */
describe('requireRole', () => {
  let http: HttpTestingController;
  let auth: AuthSessionStore;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthSessionStore);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  afterEach(() => localStorage.clear());

  function run(...roles: string[]): Promise<boolean> {
    return TestBed.runInInjectionContext(
      () => requireRole(...roles)(null as never, null as never) as Promise<boolean>,
    );
  }

  it('не пускает гостя', async () => {
    expect(await run('specialist')).toBeFalse();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('пускает специалиста, у которого kind уже в сессии', async () => {
    auth.save({ access_token: 'a', refresh_token: 'r' }, 'specialist');
    const allowed = await run('specialist', 'admin');
    expect(allowed).toBeTrue();
    // Никаких лишних запросов: роль известна из localStorage.
    http.expectNone(() => true);
  });

  it('дожидается /me, когда токены есть, а kind ещё нет', async () => {
    // Ровно состояние после login() по паролю: save(pair) без kind.
    auth.save({ access_token: 'a', refresh_token: 'r' });
    const pending = run('specialist', 'admin');
    http.expectOne((r) => r.url.endsWith('/me')).flush({ kind: 'specialist' });
    expect(await pending).toBeTrue();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('разворачивает заказчика', async () => {
    auth.save({ access_token: 'a', refresh_token: 'r' }, 'client');
    expect(await run('specialist', 'admin')).toBeFalse();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  /**
   * Роли не исключают друг друга.
   *
   * Менеджер бывает и креатором: он ведёт чужие проекты и сам снимает в
   * своих. Проверка по одной derived-строке роли разворачивала такого
   * человека с СОБСТВЕННОГО кабинета выкладок — «менеджер» перекрывал
   * «специалиста», и /me/creator/projects отвечал редиректом на главную.
   */
  it('менеджер-креатор попадает и в CRM, и в свой кабинет выкладок', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: 'a',
        refresh_token: 'r',
        kind: 'specialist',
        is_manager: true,
        is_approved: true,
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule, RouterTestingModule] });
    auth = TestBed.inject(AuthSessionStore);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);

    expect(await run('specialist', 'admin')).toBeTrue();
    expect(await run('manager', 'admin')).toBeTrue();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  /** kind = 'both' — это и клиент, и специалист, а не «клиент». */
  it('клиент-специалист проходит в оба кабинета', async () => {
    auth.save({ access_token: 'a', refresh_token: 'r' }, 'both');
    expect(await run('specialist', 'admin')).toBeTrue();
    expect(await run('client')).toBeTrue();
  });

  /**
   * Неподтверждённый менеджер в CRM не ходит — но его кабинет
   * специалиста к подтверждению отношения не имеет: подтверждают
   * менеджерство, а не человека.
   */
  it('неподтверждённое менеджерство не запирает кабинет специалиста', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: 'a',
        refresh_token: 'r',
        kind: 'specialist',
        is_manager: true,
        is_approved: false,
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule, RouterTestingModule] });
    auth = TestBed.inject(AuthSessionStore);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);

    expect(await run('specialist', 'admin')).toBeTrue();
    expect(await run('manager', 'admin')).toBeFalse();
  });
});
