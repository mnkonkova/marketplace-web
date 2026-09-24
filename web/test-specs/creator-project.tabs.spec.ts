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
 * Кабинет креатора: одна страница на десктопе, разделы на телефоне.
 *
 * В макете страница идёт сверху вниз одной лентой — деньги, выкладки,
 * задание, переписка, — и это один разговор: сколько мне за это будет →
 * что для этого сдать → по каким правилам → и с кем поговорить. Рвать
 * его вкладками на большом экране незачем.
 *
 * На телефоне та же лента не прокручивается, поэтому разделы
 * показываются по одному; переключает их нижняя полоса, а прячет —
 * тач-слой по data-sec. Десктоп про этот сигнал просто не знает, и
 * поэтому в адрес он не уходит: ссылкой делятся на проект, а не на то,
 * какой раздел был открыт на чужом телефоне.
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
            // Находки «это ваш ролик?» тянутся вместе со страницей.
            creatorSuggestions: () => of({ items: [] }),
            // «Мои аккаунты» — аккаунты проекта, тянутся вместе со страницей.
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
    // Шаблон не рендерим: здесь проверяются решения страницы, а не её
    // вёрстка, и полная разметка тянула бы за собой все виджеты кабинета
    // с их собственными запросами.
    TestBed.overrideComponent(CreatorProjectPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorProjectPage);
    fixture.detectChanges();
    return { page: fixture.componentInstance, router };
  }

  /**
   * Умолчание — «Деньги».
   *
   * Человек приходит в кабинет с вопросом «сколько мне за это будет», и
   * открываться страница обязана ответом на него, а не списком дел.
   */
  it('по умолчанию открыт раздел денег', () => {
    expect(setup().page.section()).toBe('money');
  });

  /**
   * Разделов четыре, и порядок у них тот же, что сверху вниз на
   * десктопе: деньги → выкладки → задание → переписка. Полоса на
   * телефоне обязана вести по той же дороге, а не по своей.
   */
  it('нижняя полоса повторяет порядок разделов страницы', () => {
    expect(setup().page.phoneTabs.map((t) => t.key)).toEqual([
      'money',
      'posts',
      'brief',
      'talk',
    ]);
  });

  /**
   * Раздел в адрес НЕ уходит. Ссылкой креатор делится на проект, а не на
   * то, какой кусок страницы был открыт у него на телефоне: у
   * получателя на десктопе разделов нет вовсе.
   */
  it('переключение раздела не трогает адрес', () => {
    const { page, router } = setup();
    page.section.set('posts');
    expect(page.section()).toBe('posts');
    expect(router.navigate).not.toHaveBeenCalled();
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
