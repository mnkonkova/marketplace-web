import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { of } from 'rxjs';

import { CategoryApi } from '@entities/category/api/category.api';
import { MeProfile } from '@entities/me/model/me.types';
import { MeRepository } from '@entities/me/repository/me.repository';
import { ProductionApi } from '@entities/production/api/production.api';
import { CabinetPage } from '@pages/cabinet/cabinet.page';

function profile(over: Partial<MeProfile> = {}): MeProfile {
  return {
    updated_at: '2026-01-01T00:00:00Z',
    user_id: 'u1',
    display_name: 'Аня',
    bio: '',
    currency: 'RUB',
    is_published: false,
    categories: [],
    skill_ids: [],
    is_freelance: false,
    moderation_status: 'pending_review',
    ...over,
  };
}

function setup(tab?: string): { page: CabinetPage; router: jasmine.SpyObj<Router> } {
  TestBed.resetTestingModule();
  const router = jasmine.createSpyObj<Router>('Router', ['navigate']);
  TestBed.configureTestingModule({
    providers: [
      // AuthSessionStore и корневые сторы настоящие — им нужен HttpClient.
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(tab ? { tab } : {})),
        },
      },
      { provide: Router, useValue: router },
      {
        provide: MeRepository,
        useValue: jasmine.createSpyObj<MeRepository>('MeRepository', [
          'getUser',
          'getProfile',
          'listPortfolio',
          'patchProfileFull',
        ]),
      },
      {
        provide: CategoryApi,
        useValue: jasmine.createSpyObj<CategoryApi>('CategoryApi', ['list', 'skills']),
      },
      {
        provide: ProductionApi,
        useValue: jasmine.createSpyObj<ProductionApi>('ProductionApi', ['listActive']),
      },
      {
        provide: NzMessageService,
        useValue: jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error', 'info']),
      },
      {
        provide: NzModalService,
        useValue: jasmine.createSpyObj<NzModalService>('modal', ['create', 'confirm']),
      },
    ],
  });
  // Шаблон не рендерим: страница — оболочка вокруг пяти вкладок, а нас
  // интересует её логика (табы, грязная форма, точки на заголовках).
  TestBed.overrideComponent(CabinetPage, { set: { template: '' } });
  return { page: TestBed.createComponent(CabinetPage).componentInstance, router };
}

describe('CabinetPage — вкладки', () => {
  it('по умолчанию открыта «Основное»', () => {
    const { page } = setup();
    expect(page.tab()).toBe('basic');
    expect(page.tabIndex()).toBe(0);
  });

  it('вкладка берётся из query-параметра', () => {
    const { page } = setup('skills');
    expect(page.tab()).toBe('skills');
    expect(page.tabIndex()).toBe(1);
  });

  it('неизвестный ?tab= откатывается на «Основное»', () => {
    const { page } = setup('нет-такой-вкладки');
    expect(page.tab()).toBe('basic');
  });

  it('переключение вкладки пишется в URL, «Основное» — без параметра', () => {
    const { page, router } = setup();
    page.onTabIndexChange(2);
    expect(router.navigate).toHaveBeenCalled();
    const extras = router.navigate.calls.mostRecent().args[1]!;
    expect(extras.queryParams).toEqual({ tab: 'portfolio' });
    expect(extras.replaceUrl).toBeTrue();
  });

  it('повторный выбор той же вкладки не навигирует', () => {
    const { page, router } = setup('skills');
    page.onTabIndexChange(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('CabinetPage — точки «здесь незаполнено»', () => {
  it('пустой профиль помечает все вкладки', () => {
    const { page } = setup();
    page['applyProfile'](profile({ display_name: '' }));
    expect(page.tabMissing('basic')).toBeTrue();
    expect(page.tabMissing('skills')).toBeTrue();
    expect(page.tabMissing('portfolio')).toBeTrue();
    expect(page.tabMissing('contacts')).toBeTrue();
    expect(page.tabMissing('publish')).toBeTrue();
  });

  it('заполненные контакты снимают точку с «Контактов»', () => {
    const { page } = setup();
    page['applyProfile'](profile({ contact_email: 'a@b.c', social_links: { telegram: '@anya' } }));
    expect(page.tabMissing('contacts')).toBeFalse();
    expect(page.tabMissing('basic')).toBeTrue();
  });
});

describe('CabinetPage — несохранённые изменения', () => {
  it('до загрузки профиля форма не считается грязной', () => {
    const { page } = setup();
    expect(page.hasUnsavedChanges()).toBeFalse();
  });

  it('свежезагруженный профиль чист', () => {
    const { page } = setup();
    page['applyProfile'](profile());
    expect(page.hasUnsavedChanges()).toBeFalse();
  });

  it('правка поля делает форму грязной', () => {
    const { page } = setup();
    page['applyProfile'](profile());
    page.form.city = 'Тверь';
    expect(page.hasUnsavedChanges()).toBeTrue();
  });

  it('выбор роли тоже считается правкой', () => {
    const { page } = setup();
    page['applyProfile'](profile());
    page.toggleSkill('skill-1');
    expect(page.hasUnsavedChanges()).toBeTrue();
  });

  it('после сохранения (нового applyProfile) форма снова чистая', () => {
    const { page } = setup();
    page['applyProfile'](profile());
    page.form.city = 'Тверь';
    page['applyProfile'](profile({ city: 'Тверь' }));
    expect(page.hasUnsavedChanges()).toBeFalse();
  });
});
