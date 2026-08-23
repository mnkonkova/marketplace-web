import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NzModalRef, NzModalService } from 'ng-zorro-antd/modal';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { ClientRegisterDialog } from '@features/client-register/client-register.dialog';

// У заказчика вход дешевле, чем у специалиста: одно окно и сразу поиск.
// Тесты держат именно это — роль client, редирект на /search, без мастера.
describe('ClientRegisterDialog', () => {
  let auth: jasmine.SpyObj<AuthSessionStore>;
  let router: jasmine.SpyObj<Router>;
  let ref: jasmine.SpyObj<NzModalRef>;

  function setup() {
    TestBed.resetTestingModule();
    auth = jasmine.createSpyObj<AuthSessionStore>('auth', ['register', 'emailAvailable']);
    // По умолчанию адрес свободен — проверка идёт перед регистрацией.
    auth.emailAvailable.and.returnValue(of(true));
    router = jasmine.createSpyObj<Router>('router', ['navigate']);
    ref = jasmine.createSpyObj<NzModalRef>('ref', ['close']);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionStore, useValue: auth },
        { provide: Router, useValue: router },
        { provide: NzModalRef, useValue: ref },
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['create']) },
      ],
    });
    TestBed.overrideComponent(ClientRegisterDialog, { set: { template: '' } });
    const fixture = TestBed.createComponent(ClientRegisterDialog);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function fill(cmp: ClientRegisterDialog) {
    cmp.form.setValue({
      display_name: 'ООО Ромашка',
      email: 'client@example.com',
      password: 'seedseed123',
    });
  }

  it('форма из трёх полей — лишнее в окно не тащим', () => {
    expect(Object.keys(setup().form.controls)).toEqual(['display_name', 'email', 'password']);
  });

  it('регистрирует с ролью client', () => {
    const cmp = setup();
    auth.register.and.returnValue(of({ user_id: 'u1', tokens: {} as never }));
    fill(cmp);
    cmp.submit();
    expect(auth.register).toHaveBeenCalledWith(jasmine.objectContaining({ kind: 'client' }));
  });

  it('после успеха ведёт в /search, а не в кабинет', () => {
    const cmp = setup();
    auth.register.and.returnValue(of({ user_id: 'u1', tokens: {} as never }));
    fill(cmp);
    cmp.submit();
    expect(router.navigate).toHaveBeenCalledWith(['/search']);
    expect(ref.close).toHaveBeenCalledWith(true);
  });

  it('занятый адрес не доходит до регистрации', () => {
    const cmp = setup();
    auth.emailAvailable.and.returnValue(of(false));
    fill(cmp);
    cmp.submit();
    expect(auth.register).not.toHaveBeenCalled();
    expect(cmp.emailTaken()).toBeTrue();
    expect(cmp.loading()).toBeFalse();
  });

  it('короткий пароль не отправляется', () => {
    const cmp = setup();
    cmp.form.setValue({ display_name: 'ООО', email: 'a@b.cd', password: 'abc' });
    cmp.submit();
    expect(auth.emailAvailable).not.toHaveBeenCalled();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('пустую форму не отправляет', () => {
    const cmp = setup();
    cmp.submit();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('ошибку сервера показывает и окно не закрывает', () => {
    const cmp = setup();
    auth.register.and.returnValue(throwError(() => ({ error: { message: 'Email занят' } })));
    fill(cmp);
    cmp.submit();
    expect(cmp.backendError()).toBe('Email занят');
    expect(ref.close).not.toHaveBeenCalledWith(true);
    expect(cmp.loading()).toBeFalse();
  });

  it('«я специалист» уводит в мастер с уже выбранной ролью', () => {
    const cmp = setup();
    cmp.goSpecialist();
    expect(router.navigate).toHaveBeenCalledWith(['/start'], {
      queryParams: { role: 'specialist' },
    });
  });
});
