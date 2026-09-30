import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of } from 'rxjs';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { BillingApi } from '@entities/billing/api/billing.api';
import { MeRepository } from '@entities/me/repository/me.repository';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { Publication, PublicationStatus } from '@entities/publication/model/publication.types';
import { CreatorProjectPage } from '@pages/me/creator-project/creator-project.page';

/**
 * На каком месяце открываются «Выкладки» у креатора.
 *
 * Календарей три — перед опорным, опорный и следующий, — и опора
 * раньше стояла на «сегодня». Тридцатого сентября это давало август,
 * сентябрь, октябрь, а выкладки стояли в октябре: до работы надо было
 * пролистать два пустых месяца, на телефоне — два экрана вслепую.
 *
 * Теперь опора — месяц ПЕРВОЙ НЕСДАННОЙ выкладки, не раньше текущего.
 * Проверяем по месяцам в ответе, а не по разметке: календарь
 * отрисуется по тем ключам, которые ему дали.
 */
describe('CreatorProjectPage: опорный месяц календарей', () => {
  /** Сегодня для расчётов: берём настоящее, как и страница. */
  const now = new Date();

  function monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function shifted(months: number): Date {
    return new Date(now.getFullYear(), now.getMonth() + months, 15);
  }

  function pub(over: Partial<Publication>): Publication {
    return {
      id: 'p1',
      project_id: 'pr1',
      creator_user_id: 'c1',
      due_date: `${monthKey(now)}-15T00:00:00Z`,
      status: 'planned' as PublicationStatus,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      links: [],
      overdue: false,
      views: 0,
      likes: 0,
      comments: 0,
      ...over,
    };
  }

  function setup(pubs: Publication[]) {
    TestBed.resetTestingModule();
    const router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: 'pr1' }) },
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: Router, useValue: router },
        {
          provide: PublicationApi,
          useValue: {
            creatorProjectCard: () => of({ id: 'pr1', title: 'PetFlat', platforms: ['tiktok'] }),
            creatorList: () => of({ items: pubs }),
            creatorChecklist: () => of({ items: [] }),
            creatorMaterials: () => of({ items: [] }),
            creatorSuggestions: () => of({ items: [] }),
            creatorAccounts: () => of({ items: [], secrets_enabled: true }),
            creatorReport: () => of({ collapsed: false }),
          },
        },
        { provide: BillingApi, useValue: { creatorEarnings: () => of({ periods: [] }) } },
        { provide: MeRepository, useValue: { getProfile: () => of(null) } },
        { provide: AuthSessionStore, useValue: { userId: () => 'c1' } },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
      ],
    });
    TestBed.overrideComponent(CreatorProjectPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorProjectPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('без выкладок опора остаётся на сегодня', () => {
    const keys = setup([])
      .months()
      .map((m) => m.key);

    expect(keys).toEqual([monthKey(shifted(-1)), monthKey(now), monthKey(shifted(1))]);
  });

  it('несданная выкладка в следующем месяце подтягивает окно к ней', () => {
    const keys = setup([pub({ due_date: `${monthKey(shifted(1))}-07T00:00:00Z` })])
      .months()
      .map((m) => m.key);

    // Опора — месяц выкладки, значит текущий стоит первым, а пустой
    // прошлый из окна уходит.
    expect(keys).toEqual([monthKey(now), monthKey(shifted(1)), monthKey(shifted(2))]);
  });

  it('сданные выкладки опору не тянут — их смотреть не надо', () => {
    const keys = setup([
      pub({ id: 'a', status: 'done', due_date: `${monthKey(shifted(2))}-03T00:00:00Z` }),
      pub({ id: 'b', status: 'closed_manually', due_date: `${monthKey(shifted(3))}-03T00:00:00Z` }),
    ])
      .months()
      .map((m) => m.key);

    expect(keys).toEqual([monthKey(shifted(-1)), monthKey(now), monthKey(shifted(1))]);
  });

  it('просрочка прошлого месяца окно назад не тянет', () => {
    // Она и так первой строкой в списке выкладок; уводить календари в
    // прошлое значит спрятать то, что предстоит.
    const keys = setup([
      pub({ id: 'late', due_date: `${monthKey(shifted(-2))}-10T00:00:00Z`, overdue: true }),
    ])
      .months()
      .map((m) => m.key);

    expect(keys).toEqual([monthKey(shifted(-1)), monthKey(now), monthKey(shifted(1))]);
  });

  it('отменённая выкладка опорой не бывает', () => {
    const keys = setup([
      pub({ id: 'x', status: 'cancelled', due_date: `${monthKey(shifted(2))}-05T00:00:00Z` }),
    ])
      .months()
      .map((m) => m.key);

    expect(keys).toEqual([monthKey(shifted(-1)), monthKey(now), monthKey(shifted(1))]);
  });

  it('подсветка «сегодня» остаётся на сегодня, даже когда окно уехало', () => {
    const page = setup([pub({ due_date: `${monthKey(shifted(1))}-07T00:00:00Z` })]);
    const todays = page
      .months()
      .flatMap((m) => m.cells)
      .filter((c) => c.today);

    expect(todays.length).toBe(1);
    expect(todays[0].date).toBe(`${monthKey(now)}-${String(now.getDate()).padStart(2, '0')}`);
  });
});
