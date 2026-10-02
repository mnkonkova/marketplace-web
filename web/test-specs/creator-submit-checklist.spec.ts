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
import type { ChecklistItem, Publication } from '@entities/publication/model/publication.types';
import { CreatorProjectPage } from '@pages/me/creator-project/creator-project.page';

/**
 * Сдача ролика идёт ПО ЧЕК-ЛИСТУ.
 *
 * Требования проекта — единственное, что отделяет сданный ролик от
 * переснятого: менеджер всё равно вернёт выкладку без логотипа в первых
 * секундах. Поэтому окно сдачи обязано показать пункты, а не помянуть их:
 * обязательный пункт гасит кнопку «Сдать», и если его негде отметить,
 * роль упирается в тупик — кнопка не нажимается, причина не исправляется.
 *
 * Тест держит окно сдачи целиком: пункты общие и по площадке видны,
 * кнопка заперта до отметок и отпирается после них. Разбор самих правил
 * (что к какой площадке относится) меряет creator-checklist.spec.
 */
describe('CreatorProjectPage: чек-лист при сдаче ролика', () => {
  function item(over: Partial<ChecklistItem> = {}): ChecklistItem {
    return {
      id: 'i1',
      project_id: 'pr1',
      text: 'Логотип в первые 3 секунды',
      is_required: true,
      sort_order: 0,
      ...over,
    };
  }

  const common = item({ id: 'c1' });
  const forTiktok = item({ id: 't1', text: 'Ссылка в закрепе', platform: 'tiktok' });
  const optional = item({ id: 'o1', text: 'Хештеги проекта', is_required: false });

  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: 'p1',
      project_id: 'pr1',
      creator_user_id: 'c1',
      due_date: '2026-09-20T00:00:00Z',
      status: 'planned',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      links: [],
      overdue: false,
      views: 0,
      likes: 0,
      comments: 0,
      ...over,
    };
  }

  function setup(checklist: ChecklistItem[]) {
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
            queryParamMap: of(convertToParamMap({ tab: 'pubs' })),
          },
        },
        { provide: Router, useValue: router },
        {
          provide: PublicationApi,
          useValue: {
            creatorProjectCard: () => of({ id: 'pr1', title: 'PetFlat', platforms: ['tiktok'] }),
            creatorList: () => of({ items: [pub()] }),
            creatorChecklist: () => of({ items: checklist }),
            creatorMaterials: () => of({ items: [] }),
            // Находки «это ваш ролик?» тянутся вместе со страницей.
            creatorSuggestions: () => of({ items: [] }),
            // «Мои аккаунты» — аккаунты проекта, тянутся вместе со страницей.
            creatorAccounts: () => of({ items: [], secrets_enabled: true }),
            creatorReport: () => of({ collapsed: false }),
            creatorRefreshStats: () => of({ saved: 0 }),
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
    const page = fixture.componentInstance;
    page.openSubmit(pub());
    return page;
  }

  it('в окне сдачи есть пункты чек-листа — общие и площадки', () => {
    const page = setup([common, forTiktok, optional]);
    expect(page.commonChecklist().map((i) => i.id)).toEqual(['c1', 'o1']);
    expect(page.itemsFor('tiktok').map((i) => i.id)).toEqual(['t1']);
    expect(page.noChecklist()).toBeFalse();
  });

  it('пока обязательные пункты не отмечены, сдать нельзя — и сказано почему', () => {
    const page = setup([common, forTiktok, optional]);
    expect(page.canSend()).toBeFalse();
    expect(page.submitHint()).toBeTruthy();
  });

  it('после отметки обязательных сдача открывается', () => {
    const page = setup([common, forTiktok, optional]);
    page.setUrl('tiktok', 'https://www.tiktok.com/@creator/video/7300000000000000000');
    page.toggleItem(common);
    page.toggleItem(forTiktok);
    expect(page.canSend()).toBeTrue();
  });

  it('необязательный пункт сдачу не держит', () => {
    const page = setup([optional]);
    page.setUrl('tiktok', 'https://www.tiktok.com/@creator/video/7300000000000000000');
    expect(page.canSend()).toBeTrue();
  });

  /**
   * Чек-листа может не быть вовсе — шаблон к проекту не подключили.
   * Молчать об этом нельзя: креатор решит, что требований нет, а менеджер
   * решит, что он их проигнорировал.
   */
  it('без чек-листа сдача не блокируется, но об отсутствии сказано', () => {
    const page = setup([]);
    expect(page.noChecklist()).toBeTrue();
    page.setUrl('tiktok', 'https://www.tiktok.com/@creator/video/7300000000000000000');
    expect(page.canSend()).toBeTrue();
  });
});
