import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of, throwError } from 'rxjs';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ProjectAccount } from '@entities/publication/model/publication.types';
import { ProjectAccountsComponent } from '@widgets/project-accounts/project-accounts.component';

/**
 * Доступы к аккаунтам бренда.
 *
 * Правило, которое легко потерять при следующей правке: пароль не ездит
 * в списке. Экран проекта показывают начальству и вставляют в
 * коммерческое — пароль от аккаунта бренда не должен появляться там сам
 * собой. Поэтому в списке только признак, а значение берётся отдельным
 * запросом, по нажатию.
 */
describe('ProjectAccountsComponent', () => {
  function account(over: Partial<ProjectAccount> = {}): ProjectAccount {
    return {
      id: 'a1',
      project_id: 'pr1',
      platform: 'tiktok',
      title: 'основной',
      url: 'https://www.tiktok.com/@brand',
      login: 'brand.smm',
      has_password: true,
      note: '',
      sort_order: 0,
      created_at: '2026-09-01T00:00:00Z',
      ...over,
    };
  }

  function setup(opts: {
    role?: 'manager' | 'client' | 'creator';
    items?: ProjectAccount[];
    secretsEnabled?: boolean;
    secret?: ReturnType<typeof of>;
  }) {
    const api = {
      managerAccounts: jasmine
        .createSpy('managerAccounts')
        .and.returnValue(
          of({ items: opts.items ?? [], secrets_enabled: opts.secretsEnabled !== false }),
        ),
      clientAccounts: jasmine
        .createSpy('clientAccounts')
        .and.returnValue(
          of({ items: opts.items ?? [], secrets_enabled: opts.secretsEnabled !== false }),
        ),
      managerAccountSecret: jasmine
        .createSpy('managerAccountSecret')
        .and.returnValue(opts.secret ?? of({ password: 'Autumn-2026!' })),
      clientAccountSecret: jasmine
        .createSpy('clientAccountSecret')
        .and.returnValue(opts.secret ?? of({ password: 'Autumn-2026!' })),
      managerAddAccount: jasmine
        .createSpy('managerAddAccount')
        .and.callFake((_p: string, body: Record<string, unknown>) =>
          of(account({ id: 'a2', ...body })),
        ),
      managerUpdateAccount: jasmine
        .createSpy('managerUpdateAccount')
        .and.callFake((_p: string, id: string, body: Record<string, unknown>) =>
          of(account({ id, ...body })),
        ),
      managerRemoveAccount: jasmine.createSpy('managerRemoveAccount').and.returnValue(of(void 0)),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        {
          provide: NzMessageService,
          useValue: jasmine.createSpyObj('msg', ['success', 'error', 'info']),
        },
      ],
    });
    const fixture = TestBed.createComponent(ProjectAccountsComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.componentRef.setInput('role', opts.role ?? 'client');
    fixture.detectChanges();
    return { fixture, cmp: fixture.componentInstance, api };
  }

  it('заказчик читает свою ручку, менеджер — свою', () => {
    const asClient = setup({ role: 'client' });
    expect(asClient.api.clientAccounts).toHaveBeenCalledWith('pr1');
    expect(asClient.api.managerAccounts).not.toHaveBeenCalled();

    const asManager = setup({ role: 'manager' });
    expect(asManager.api.managerAccounts).toHaveBeenCalledWith('pr1');
  });

  it('пароль в списке не показан — только точки', () => {
    const { fixture } = setup({ items: [account()] });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('••••••••');
    expect(text).not.toContain('Autumn-2026!');
  });

  it('«Показать» дёргает отдельную ручку и открывает пароль', () => {
    const { fixture, cmp, api } = setup({ items: [account()] });
    cmp.reveal(account());
    fixture.detectChanges();
    expect(api.clientAccountSecret).toHaveBeenCalledWith('pr1', 'a1');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Autumn-2026!');
  });

  it('повторное нажатие прячет пароль обратно', () => {
    const { fixture, cmp } = setup({ items: [account()] });
    cmp.reveal(account());
    cmp.reveal(account());
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Autumn-2026!');
  });

  it('заказчик не правит: кнопок редактирования у него нет', () => {
    const { fixture } = setup({ role: 'client', items: [account()] });
    const el = fixture.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Править');
    expect(labels).not.toContain('Добавить аккаунт');
  });

  it('менеджер правит и добавляет', () => {
    const { fixture } = setup({ role: 'manager', items: [account()] });
    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toContain('Править');
    expect(labels).toContain('Добавить аккаунт');
  });

  /**
   * Пустое поле пароля при правке — это «оставить прежний», а не
   * «стереть». Иначе правка логина молча снесла бы пароль, который
   * менеджер даже не видел.
   */
  it('правка без пароля поле password не шлёт', () => {
    const { cmp, api } = setup({ role: 'manager', items: [account()] });
    cmp.startEdit(account());
    cmp.form.login = 'brand.new';
    cmp.save();
    const body = api.managerUpdateAccount.calls.mostRecent().args[2] as Record<string, unknown>;
    expect('password' in body).toBeFalse();
    expect(body['login']).toBe('brand.new');
  });

  it('«Стереть пароль» шлёт пустую строку — это другое намерение', () => {
    const { cmp, api } = setup({ role: 'manager', items: [account()] });
    cmp.startEdit(account());
    cmp.save(true);
    const body = api.managerUpdateAccount.calls.mostRecent().args[2] as Record<string, unknown>;
    expect(body['password']).toBe('');
  });

  it('доступ без ссылки, логина и названия не отправляется', () => {
    const { cmp, api } = setup({ role: 'manager' });
    cmp.startAdd();
    cmp.form.title = '';
    cmp.form.url = '';
    cmp.form.login = '';
    cmp.save();
    expect(api.managerAddAccount).not.toHaveBeenCalled();
  });

  /**
   * Ключа шифрования у сервиса нет — пароли не хранятся. Молчать об этом
   * нельзя: «поле пароля куда-то делось» читается как поломка.
   */
  it('без ключа шифрования об этом сказано словами', () => {
    const { fixture } = setup({ role: 'manager', secretsEnabled: false, items: [] });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Пароли сейчас не хранятся',
    );
  });

  it('ошибка показа пароля не роняет список', () => {
    const { cmp, fixture } = setup({
      items: [account()],
      secret: throwError(() => ({ status: 501 })),
    });
    cmp.reveal(account());
    fixture.detectChanges();
    expect(cmp.items().length).toBe(1);
    expect(cmp.busy()).toBeNull();
  });

  it('пустой список объясняется словами, а не пустым местом', () => {
    const { fixture } = setup({ role: 'client', items: [] });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Менеджер ещё не заполнил',
    );
  });

  /**
   * «Такой уже есть» — не отказ, а подсказка, куда идти.
   *
   * У человека по одной строке на площадку, и заводя вторую, он почти
   * всегда хочет заменить адрес в первой: аккаунт сменили, ролики
   * теперь выходят с другого. Красная плашка «поправьте существующий»
   * отправляла его искать эту строку глазами.
   */
  it('дубликат площадки переключает на правку существующей строки', () => {
    const existing = account({ id: 'a1', platform: 'tiktok', creator_user_id: 'u1' });
    const { cmp, api, fixture } = setup({ role: 'manager', items: [existing] });
    api.managerAddAccount.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'account_exists' } })),
    );

    cmp.startAdd('u1');
    cmp.form.platform = 'tiktok';
    cmp.form.url = 'https://www.tiktok.com/@brand2';
    cmp.save();
    fixture.detectChanges();

    expect(cmp.editing()).toBe('a1');
    const msg = TestBed.inject(NzMessageService) as jasmine.SpyObj<NzMessageService>;
    expect(msg.info).toHaveBeenCalled();
    expect(msg.error).not.toHaveBeenCalled();
  });

  /** Строки не нашлось — тогда это настоящая ошибка, и о ней говорят. */
  it('дубликат без найденной строки остаётся ошибкой', () => {
    const { cmp, api, fixture } = setup({ role: 'manager', items: [] });
    api.managerAddAccount.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'account_exists' } })),
    );

    cmp.startAdd('u1');
    cmp.form.platform = 'vk';
    cmp.form.url = 'https://vk.com/brand';
    cmp.save();
    fixture.detectChanges();

    const msg = TestBed.inject(NzMessageService) as jasmine.SpyObj<NzMessageService>;
    expect(msg.error).toHaveBeenCalled();
  });
});