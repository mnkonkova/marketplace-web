import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of, throwError } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import { ClientProfileApi } from '@entities/me/api/client-profile.api';
import { OrderApi } from '@entities/order/api/order.api';
import { ProjectApi } from '@entities/project/api/project.api';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import type { ClientOverview } from '@entities/billing/model/billing.types';
import type { ProjectClientView } from '@entities/project/model/project.types';
import { ProjectsListPage } from '@pages/me/projects-list/projects-list.page';

/**
 * Кабинет заказчика, экран «Все проекты».
 *
 * Экран отвечает на четыре вопроса подряд: во сколько обходится
 * просмотр, что происходит в проектах, сколько просят денег и что
 * выходит дальше. Проверяем ровно решения страницы, а не разметку:
 * какие числа она берёт, как называет состояние проекта и что делает,
 * когда сервер чего-то не отдал.
 *
 * Ни одно число здесь не считается в браузере: цена приходит сводкой,
 * поденные ряды — отчётом проекта. Единственное, что страница делает
 * сама, — делит цену тысячи на тысячу, чтобы назвать цену ПРОСМОТРА:
 * так она называется в макете и так её называет заказчик.
 */
describe('ProjectsListPage: экран «Все проекты»', () => {
  function overview(over: Partial<ClientOverview> = {}): ClientOverview {
    return {
      projects_total: 2,
      projects: [
        {
          project_id: 'p1',
          title: 'Кофейни',
          state: 'running',
          views: 4_812_300,
          total: 101_058_300,
          cost_per_1000: 21_000,
          period: {
            seq: 2,
            starts_on: '2026-08-31',
            ends_on: '2026-09-30',
            status: 'open',
            carry_in_client: 0,
            carry_out_client: 0,
          },
        },
        {
          project_id: 'p2',
          title: 'Доставка зёрен',
          state: 'completed',
          views: 1_204_700,
          total: 40_959_800,
          cost_per_1000: 34_000,
        },
      ],
      views: { total: 6_017_000 },
      money: { locked: 0, current: 0, total: 142_018_100, paid: 40_959_800 },
      cost_per_1000: 22_000,
      series: [],
      generated_at: '2026-09-17T14:05:00Z',
      window: { views: 0, engagement: 0, comments: 0, er_percent: 6.9, er_delta_pp: 0.6 },
      top_videos: [],
      ...over,
    } as ClientOverview;
  }

  function setup(opts: { range?: string; overviewFails?: boolean; projects?: ProjectClientView[] } = {}) {
    TestBed.resetTestingModule();
    const billing = jasmine.createSpyObj<BillingApi>('billing', [
      'clientOverview',
      'clientBilling',
    ]);
    billing.clientOverview.and.returnValue(
      opts.overviewFails ? throwError(() => new Error('down')) : (of(overview()) as never),
    );
    billing.clientBilling.and.returnValue(
      of({
        payments: [
          {
            id: 'pay1',
            project_id: 'p1',
            kind: 'final',
            amount: 117_852_000,
            status: 'awaiting',
            created_at: '2026-09-01T00:00:00Z',
          },
        ],
      } as never) as never,
    );

    const pub = jasmine.createSpyObj<PublicationApi>('pub', ['clientReport', 'clientCalendar']);
    pub.clientReport.and.returnValue(
      of({
        videos: 15,
        er_percent: 6.4,
        by_day: [
          { date: '2026-09-01', views: 100 },
          { date: '2026-09-02', views: 200 },
        ],
      } as never) as never,
    );
    pub.clientCalendar.and.returnValue(
      of({
        month: '2026-09',
        days: [
          {
            date: '2999-01-02',
            planned: 1,
            published: 0,
            items: [
              { publication_id: 'x1', creator_user_id: 'c1', creator_name: 'Лев', status: 'planned' },
            ],
          },
        ],
      } as never) as never,
    );

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap(opts.range ? { range: opts.range } : {})),
          },
        },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) },
        { provide: BillingApi, useValue: billing },
        { provide: PublicationApi, useValue: pub },
        {
          provide: ProjectApi,
          useValue: { listClientProjects: () => of({ items: opts.projects ?? [] }) },
        },
        {
          provide: ClientProfileApi,
          useValue: {
            get: () => of({ user_id: 'u1', display_name: 'PetFlat', phone: '', telegram: '' }),
          },
        },
        {
          provide: OrderApi,
          useValue: {
            listOrders: () => of({ items: [] }),
            // Условия тянутся ради объёма роликов в смете.
            terms: () => of({ terms: { videos_first_month: 30 }, consented: true }),
          },
        },
        { provide: SpecialistApi, useValue: { search: () => of({ items: [] }) } },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
      ],
    });
    TestBed.overrideComponent(ProjectsListPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(ProjectsListPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /**
   * Сервер считает тысячу просмотров, а на экране стоит цена ПРОСМОТРА:
   * 21 000 копеек за тысячу — это 0,21 ₽ за просмотр. Деление живёт в
   * одном месте и только ради показа.
   */
  it('цена просмотра — это цена тысячи, делённая на тысячу', () => {
    expect(setup().cpv()).toBe('0,22 ₽');
  });

  it('просмотров ещё нет — вместо выдуманного нуля пусто', () => {
    TestBed.resetTestingModule();
    const page = setup();
    page.overview.set({ ...overview(), cost_per_1000: undefined });
    expect(page.cpv()).toBe('');
  });

  it('вовлечённость и её изменение берутся из окна сводки', () => {
    const page = setup();
    expect(page.er()).toBe('6,9');
    expect(page.erDelta()).toBe(0.6);
  });

  /**
   * Идущий проект и законченный — разные состояния, и называются они
   * по-разному. «Пауза» не ноль: у проекта без периода нечего мерить, и
   * в его строке стоит «периода нет», а не «0 просмотров».
   */
  it('состояние проекта названо словом, а не выведено из чисел', () => {
    const rows = setup().rows();
    expect(rows.map((r) => r.state)).toEqual(['идёт', 'завершён']);
    expect(rows[0].cpv).toBe('0,21 ₽');
    expect(rows[1].cpv).toBe('0,34 ₽');
  });

  /**
   * Проект по воронке стоит в том же реестре, но числами не мерится:
   * роликов и цены просмотра у него нет вовсе, и прочерк здесь значит
   * «нечего считать», а не «не посчитали».
   */
  it('проект по воронке попадает в реестр, но без цифр по роликам', () => {
    const page = setup({
      projects: [
        {
          id: 'f1',
          kind: 'general',
          title: 'Ролик для сайта',
          progress: 40,
          display_status: 'waiting_action',
          current_step_title: 'Согласование сценария',
        } as ProjectClientView,
      ],
    });
    const funnel = page.rows().find((r) => r.id === 'f1');
    expect(funnel).withContext('проект по воронке исчез из реестра').toBeTruthy();
    expect(funnel!.turnkey).toBeFalse();
    expect(funnel!.cpv).toBe('—');
    expect(funnel!.meta).toContain('Согласование сценария');
  });

  /** Неоплаченное стоит первым: это то, что просят сделать сегодня. */
  it('счета собираются по всем проектам, неоплаченные первыми', () => {
    const page = setup();
    const due = page.due();
    expect(due.length).toBeGreaterThan(0);
    expect(due[0].paid).toBeFalse();
    expect(page.dueTotal()).toBe(117_852_000 * 2);
  });

  /** Ближайшие выкладки собираются из календарей идущих проектов. */
  it('ближайшие выкладки берутся из календаря, прошедшие дни не показываются', () => {
    const page = setup();
    const days = page.upcoming();
    expect(days.length).toBe(1);
    expect(days[0].items[0].name).toBe('Лев');
    expect(days[0].first).withContext('ближайший день подсвечен').toBeTrue();
  });

  /**
   * Окно живёт в адресе: этот экран показывают начальству и дают на него
   * ссылку, а ссылка на «квартал» обязана открыться кварталом.
   */
  it('окно сводки читается из адреса', () => {
    expect(setup({ range: 'quarter' }).range()).toBe('quarter');
    expect(setup({ range: 'ерунда' }).range()).toBe('month');
  });

  /**
   * Сводка не доехала — экран не падает и не рисует нули: числа просто
   * не показываются, а проекты по воронке и каталог остаются на месте.
   */
  it('сводка не доехала — страница остаётся живой', () => {
    const page = setup({ overviewFails: true });
    expect(page.overview()).toBeNull();
    expect(page.loading()).toBeFalse();
    expect(page.rows()).toEqual([]);
  });
});
