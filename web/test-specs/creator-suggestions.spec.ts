import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of, throwError } from 'rxjs';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { BillingApi } from '@entities/billing/api/billing.api';
import { MeRepository } from '@entities/me/repository/me.repository';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { LinkSuggestion } from '@entities/publication/model/publication.types';
import { CreatorProjectPage } from '@pages/me/creator-project/creator-project.page';

/**
 * «Это ваш ролик?» — находка сервиса в кабинете креатора.
 *
 * Площадка видит ролик раньше, чем человек успевает вставить ссылку:
 * ролик вышел, набирает просмотры, а в плане числится несданным.
 * Привязать его молча нельзя — ошибка сопоставления припишет человеку
 * чужую работу, и узнают об этом из счёта. Поэтому вопрос и два ответа.
 */
describe('CreatorProjectPage: «это ваш ролик?»', () => {
  function suggestion(over: Partial<LinkSuggestion> = {}): LinkSuggestion {
    return {
      id: over.id ?? 's1',
      project_id: over.project_id ?? 'pr1',
      project_title: 'PetFlat',
      creator_user_id: 'c1',
      platform: 'tiktok',
      url: 'https://www.tiktok.com/@anya.kim/video/7300000000000000001',
      title: 'Раф без сахара — можно?',
      author_handle: '@anya.kim',
      published_at: '2026-09-16T00:00:00Z',
      created_at: '2026-09-17T00:00:00Z',
      suggested_publication_id: over.suggested_publication_id ?? 'p9',
      suggested_due_date: '2026-09-19',
      ...over,
    } as LinkSuggestion;
  }

  function setup(items: LinkSuggestion[]) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'creatorProjectCard',
      'creatorList',
      'creatorChecklist',
      'creatorMaterials',
      'creatorReport',
      'creatorSuggestions',
      'creatorAccounts',
      'creatorLinkSuggestion',
      'creatorDismissSuggestion',
    ]);
    api.creatorProjectCard.and.returnValue(of({ id: 'pr1', title: 'PetFlat' }) as never);
    api.creatorList.and.returnValue(of({ items: [] }) as never);
    api.creatorChecklist.and.returnValue(of({ items: [] }) as never);
    api.creatorMaterials.and.returnValue(of({ items: [] }) as never);
    api.creatorReport.and.returnValue(of({ collapsed: false }) as never);
    api.creatorSuggestions.and.returnValue(of({ items }) as never);
    api.creatorAccounts.and.returnValue(of({ items: [], secrets_enabled: true }) as never);
    api.creatorLinkSuggestion.and.returnValue(of({ id: 'p9' }) as never);
    api.creatorDismissSuggestion.and.returnValue(of(undefined) as never);

    const msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error']);
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
        { provide: PublicationApi, useValue: api },
        { provide: BillingApi, useValue: { creatorEarnings: () => of({ periods: [] }) } },
        { provide: MeRepository, useValue: { getProfile: () => of(null) } },
        { provide: AuthSessionStore, useValue: { userId: () => 'c1' } },
        { provide: NzMessageService, useValue: msg },
      ],
    });
    TestBed.overrideComponent(CreatorProjectPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorProjectPage);
    fixture.detectChanges();
    return { page: fixture.componentInstance, api, msg };
  }

  /**
   * Находки приходят по ВСЕМ проектам сразу — карточка рождается от
   * площадки, а не от проекта. На странице одного проекта чужие
   * показывать нельзя: человек привяжет ролик не туда.
   */
  it('на странице проекта видны только его находки', () => {
    const { page } = setup([suggestion(), suggestion({ id: 's2', project_id: 'pr2' })]);
    expect(page.suggestions().map((s) => s.id)).toEqual(['s1']);
  });

  it('«да, мой» привязывает к предложенной выкладке и убирает карточку', () => {
    const { page, api } = setup([suggestion()]);
    // После привязки страница перечитывает выкладки — вместе с ними
    // уезжает и список находок: решённой карточки сервер больше не
    // отдаёт. Повторяем это здесь, иначе тест проверял бы заглушку.
    api.creatorSuggestions.and.returnValue(of({ items: [] }) as never);
    page.linkSuggestion(page.suggestions()[0]);
    expect(api.creatorLinkSuggestion).toHaveBeenCalledWith('s1', 'p9');
    expect(page.suggestions().length).toBe(0);
  });

  it('«не мой» убирает карточку, ничего не привязывая', () => {
    const { page, api } = setup([suggestion()]);
    page.dismissSuggestion(page.suggestions()[0]);
    expect(api.creatorDismissSuggestion).toHaveBeenCalledWith('s1');
    expect(api.creatorLinkSuggestion).not.toHaveBeenCalled();
    expect(page.suggestions().length).toBe(0);
  });

  /**
   * Неудачная привязка обязана оставить карточку на месте: исчезнувшая
   * карточка читается как «привязали», и человек уйдёт со страницы,
   * считая ролик сданным.
   */
  it('отказ сервера карточку не убирает', () => {
    const { page, api, msg } = setup([suggestion()]);
    api.creatorLinkSuggestion.and.returnValue(throwError(() => ({ status: 409 })) as never);
    page.linkSuggestion(page.suggestions()[0]);
    expect(page.suggestions().length).toBe(1);
    expect(msg.error).toHaveBeenCalled();
  });

  /**
   * Подсказка приходит с сервера и считается при чтении: перенос срока
   * её не ломает. Если подходящей выкладки нет, кнопки «Привязать к
   * такому-то числу» показывать некуда — но карточка остаётся: ролик
   * всё равно надо опознать.
   */
  it('без подходящей выкладки карточка остаётся, а даты у неё нет', () => {
    const { page } = setup([
      suggestion({ suggested_publication_id: undefined, suggested_due_date: undefined }),
    ]);
    expect(page.suggestions().length).toBe(1);
    expect(page.suggestions()[0].suggested_due_date).toBeUndefined();
  });

  /** Страница выкладок не должна падать из-за подсказки. */
  it('ошибка запроса находок страницу не ломает', () => {
    TestBed.resetTestingModule();
    const { page, api } = setup([]);
    api.creatorSuggestions.and.returnValue(throwError(() => ({ status: 500 })) as never);
    expect(page.suggestions()).toEqual([]);
  });

  /**
   * Свёртка находок.
   *
   * Сервис обходит аккаунты креаторов каждый день, поэтому находок
   * копится много, и стоят они ПЕРЕД календарём выкладок — ради
   * которого страницу и открывают. Свёрнутый список бережёт это место;
   * свёрнутый раньше времени — просит лишнее нажатие ни за что.
   */
  describe('свёртка', () => {
    function many(n: number): LinkSuggestion[] {
      return Array.from({ length: n }, (_, i) => suggestion({ id: `s${i + 1}` }));
    }

    /**
     * Три вопроса читаются с экрана как есть. Прятать их под кнопку —
     * значит добавить нажатие, за которым не окажется ничего нового.
     */
    it('три находки показываются целиком, без свёртки', () => {
      const { page } = setup(many(3));
      expect(page.suggestFolded()).toBeFalse();
      expect(page.suggestListVisible()).toBeTrue();
    });

    /**
     * Свёрнуто именно ПО УМОЛЧАНИЮ: открытый список при загрузке
     * оставил бы календарь за нижним краем экрана — то есть свёртки бы
     * не было вовсе.
     */
    it('четыре находки сворачиваются в строку-итог', () => {
      const { page } = setup(many(4));
      expect(page.suggestFolded()).toBeTrue();
      expect(page.suggestExpanded()).toBeFalse();
      expect(page.suggestListVisible()).toBeFalse();
      expect(page.suggestSummary()).toBe('Нашли 4 ролика');
    });

    /**
     * Число в строке — единственное, что человек о находках узнаёт до
     * раскрытия, и «Нашли 5 ролика» обесценивает всю строку.
     */
    it('число в строке-итоге склоняется', () => {
      expect(setup(many(5)).page.suggestSummary()).toBe('Нашли 5 роликов');
      expect(setup(many(21)).page.suggestSummary()).toBe('Нашли 21 ролик');
    });

    /** Раскрытие обязано показать ВСЕ находки, а не первые несколько. */
    it('раскрытие показывает весь список', () => {
      const { page } = setup(many(7));
      page.toggleSuggest();
      expect(page.suggestExpanded()).toBeTrue();
      expect(page.suggestListVisible()).toBeTrue();
      expect(page.suggestions().length).toBe(7);
      // И обратно: раскрытый список — то же временное состояние, из
      // которого должен быть выход без перезагрузки страницы.
      page.toggleSuggest();
      expect(page.suggestListVisible()).toBeFalse();
    });

    /**
     * Креатор отвечает на находки прямо здесь. Когда их осталось три,
     * свёртка обязана уйти сама — иначе после последнего «не мой»
     * человек упирается в кнопку «посмотреть» ради трёх карточек,
     * которые и так помещались на экран.
     */
    it('после ответов свёртка исчезает сама', () => {
      const { page } = setup(many(4));
      expect(page.suggestListVisible()).toBeFalse();
      page.dismissSuggestion(page.suggestions()[0]);
      expect(page.suggestions().length).toBe(3);
      expect(page.suggestFolded()).toBeFalse();
      expect(page.suggestListVisible()).toBeTrue();
    });
  });
});
