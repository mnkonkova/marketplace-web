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
import type { Publication } from '@entities/publication/model/publication.types';
import { CreatorProjectPage } from '@pages/me/creator-project/creator-project.page';

/**
 * Кабинет креатора: три раздела вместо одной простыни.
 *
 * Страница шла подряд — деньги, достижения, история, ближайшее дело,
 * тринадцать выкладок и переписка, — и на телефоне это было под пять
 * тысяч пикселей. Разделов теперь три, и они отвечают на три разных
 * вопроса: «сколько мне за это будет», «что у меня со сдачей», «что
 * сказал менеджер».
 *
 * Здесь проверяется то, за что отвечает сама страница: какой раздел
 * открыт, откуда он берётся и что попадает в адрес. Раскладку разделов
 * меряет creator-cabinet.layout.spec, вёрстку прибавки —
 * creator-ladder.component.spec.
 */
describe('CreatorProjectPage: разделы кабинета', () => {
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

  /** Сданная выкладка: пять площадок из пяти и статус done. */
  function done(id: string): Publication {
    return pub({ id, status: 'done' });
  }

  function setup(tab?: string, pubs: Publication[] = []) {
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
            queryParamMap: of(convertToParamMap(tab ? { tab } : {})),
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
            creatorReport: () => of({ collapsed: false }),
          },
        },
        { provide: BillingApi, useValue: { creatorEarnings: () => of({ periods: [] }) } },
        { provide: MeRepository, useValue: { getProfile: () => of(null) } },
        { provide: AuthSessionStore, useValue: { userId: () => 'c1' } },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
      ],
    });
    // Шаблон не рендерим: здесь проверяются решения страницы, а не её
    // вёрстка, и полная разметка тянула бы за собой все виджеты кабинета
    // с их собственными запросами.
    TestBed.overrideComponent(CreatorProjectPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorProjectPage);
    fixture.detectChanges();
    return { page: fixture.componentInstance, router };
  }

  /**
   * Умолчание — «Общая».
   *
   * Человек приходит в кабинет с вопросом «сколько мне за это будет», и
   * открываться страница обязана ответом на него, а не списком дел.
   */
  it('без хвоста в адресе открыта общая вкладка', () => {
    expect(setup().page.tab()).toBe('overview');
  });

  it('вкладка берётся из адреса: ссылка открывается тем, чем делились', () => {
    expect(setup('pubs').page.tab()).toBe('pubs');
    expect(setup('talk').page.tab()).toBe('talk');
  });

  /**
   * Чужой хвост — не повод показать пустую страницу. `?tab=деньги` из
   * старой ссылки или опечатка в адресе обязаны открыть общую, а не
   * раздел, которого нет: вкладки не совпали бы ни с одной, и не
   * нарисовалось бы ничего.
   */
  it('неизвестный раздел в адресе откатывается к общей', () => {
    expect(setup('money').page.tab()).toBe('overview');
  });

  /**
   * Открытая вкладка живёт в АДРЕСЕ, а не в памяти компонента: ссылку на
   * свои выкладки креатор кидает менеджеру.
   */
  it('переключение вкладки уходит в адрес', () => {
    const { page, router } = setup();
    page.setTab('pubs');
    expect(router.navigate).toHaveBeenCalled();
    const args = router.navigate.calls.mostRecent().args[1] as { queryParams: { tab: string } };
    expect(args.queryParams.tab).toBe('pubs');
  });

  /** Умолчание в адресе не живёт: общая — это просто адрес проекта. */
  it('возврат на общую убирает хвост из адреса, а не пишет tab=overview', () => {
    const { page, router } = setup('pubs');
    page.setTab('overview');
    const args = router.navigate.calls.mostRecent().args[1] as { queryParams: { tab: null } };
    expect(args.queryParams.tab).toBeNull();
  });

  /**
   * «Написать» в шапке проекта.
   *
   * Раньше прокручивала к якорю #talk в подвале простыни. Переписка —
   * вкладка, и якоря на общей в DOM нет: без переключения кнопка молча не
   * делала бы ничего.
   */
  it('«Написать» открывает переписку, а не ищет якорь на общей', () => {
    const { page, router } = setup();
    page.openTalk();
    expect(router.navigate)
      .withContext('«Написать» никуда не ведёт: переписки на общей вкладке нет')
      .toHaveBeenCalled();
    const args = router.navigate.calls.mostRecent().args[1] as { queryParams: { tab: string } };
    expect(args.queryParams.tab).toBe('talk');
  });

  /**
   * Счётчик на вкладке выкладок.
   *
   * Список ушёл под вкладку, и несданная выкладка больше не попадается на
   * глаза сама. Число несданных — единственное, по чему человек решает,
   * надо ли туда заходить.
   */
  describe('счётчик несданных', () => {
    it('считает только несданные', () => {
      const { page } = setup(undefined, [pub({ id: 'a' }), done('b'), done('c')]);
      expect(page.openCount()).toBe(1);
    });

    it('всё сдано — счётчика нет: «0» в кружке читается как незакрытое дело', () => {
      const { page } = setup(undefined, [done('a'), done('b')]);
      expect(page.openCount()).toBe(0);
    });

    /**
     * Отменённые в счёт не идут: их сняли с плана, сдавать по ним нечего.
     * Счётчик считает по тому же ordered(), что и сам список, — иначе
     * вкладка обещала бы выкладку, которой в списке нет.
     */
    it('отменённые не считаются', () => {
      const { page } = setup(undefined, [pub({ id: 'a', status: 'cancelled' }), done('b')]);
      expect(page.openCount()).toBe(0);
    });
  });
});
