import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Params, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, map, of, throwError } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { ClientOverview, OverviewRange } from '@entities/billing/model/billing.types';
import { ClientOverviewComponent } from '@widgets/client-overview/client-overview.component';

/**
 * Сводка заказчика по всем проектам.
 *
 * Считает здесь только то, что нельзя посчитать на сервере, — ряд
 * графика и порядок проектов. Суммы, стоимость тысячи, доли площадок и
 * приросты приходят готовыми: второй расчёт дал бы на двух экранах два
 * разных числа.
 *
 * Отдельно проверяем окно: оно живёт в адресе, а не в памяти вкладки, —
 * этот экран показывают начальству и на него дают ссылку.
 */
describe('ClientOverviewComponent', () => {
  function overview(over: Partial<ClientOverview> = {}): ClientOverview {
    return {
      projects_total: 1,
      projects: [],
      views: {
        total: 3_000_000,
        by_platform: { tiktok: 2_000_000, instagram: 500_000, youtube: 300_000, vk: 150_000 },
      },
      money: { locked: 0, current: 16_800_000, total: 16_800_000, paid: 0 },
      cost_per_1000: 5600,
      series: [],
      generated_at: '2026-09-14T00:00:00Z',
      ...over,
    };
  }

  /** Адрес под нашим управлением: меняем query — компонент реагирует. */
  function routeStub(initial: Params) {
    const q$ = new BehaviorSubject<Params>(initial);
    return {
      q$,
      route: {
        snapshot: { queryParamMap: convertToParamMap(initial) },
        queryParamMap: q$.pipe(map((p) => convertToParamMap(p))),
      } as unknown as ActivatedRoute,
    };
  }

  function setup(data: ClientOverview | null, query: Params = {}) {
    TestBed.resetTestingModule();
    const asked: (OverviewRange | undefined)[] = [];
    const api = {
      clientOverview: (range?: OverviewRange) => {
        asked.push(range);
        return data ? of(data) : throwError(() => new Error('нет связи'));
      },
    };
    const { q$, route } = routeStub(query);
    TestBed.configureTestingModule({
      providers: [
        { provide: BillingApi, useValue: api },
        { provide: ActivatedRoute, useValue: route },
        {
          provide: Router,
          useValue: jasmine.createSpyObj<Router>('Router', ['navigate'], { url: '/me/projects' }),
        },
      ],
    });
    TestBed.overrideComponent(ClientOverviewComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ClientOverviewComponent);
    fixture.detectChanges();
    return { cmp: fixture.componentInstance, asked, go: (q: Params) => q$.next(q) };
  }

  describe('окно', () => {
    it('окно берётся из адреса и уходит в запрос', () => {
      const { cmp, asked } = setup(overview(), { range: 'quarter' });
      expect(cmp.range()).toBe('quarter');
      expect(asked).toEqual(['quarter']);
    });

    it('адреса без окна хватает: по умолчанию месяц', () => {
      const { cmp, asked } = setup(overview());
      expect(cmp.range()).toBe('month');
      expect(asked).toEqual(['month']);
    });

    /**
     * «Назад» в браузере обязан вернуть прошлое окно вместе с числами —
     * иначе ссылка на квартал открывает квартал только с первого раза.
     */
    it('смена окна в адресе перезапрашивает числа', () => {
      const { cmp, asked, go } = setup(overview(), { range: 'month' });
      go({ range: 'week' });
      expect(cmp.range()).toBe('week');
      expect(asked).toEqual(['month', 'week']);
    });

    it('то же окно второй раз не перезапрашивается', () => {
      const { asked, go } = setup(overview(), { range: 'month' });
      go({ range: 'month', other: '1' });
      expect(asked).toEqual(['month']);
    });
  });

  /**
   * Сравнение с рынком стоит рядом с деньгами, а не под оконным героем:
   * считается оно от цены тысячи за всё время. Без своей цены сравнивать
   * не с чем, и блока тогда нет вовсе — сравнение с пустым местом
   * выглядело бы подтасовкой.
   */
  describe('сравнение с рынком', () => {
    const market = [
      {
        key: 'bloggers',
        title: 'Реклама у блогеров',
        price_per_1000: 100_000,
        source: 'Прайсы агентств, август 2026',
        measured_on: '2026-09-01',
        times_cheaper: 17.9,
      },
    ];

    it('есть и наша цена, и рынок — блок показываем', () => {
      expect(setup(overview({ market })).cmp.hasMarket()).toBeTrue();
    });

    it('своей цены тысячи нет — сравнивать не с чем', () => {
      expect(setup(overview({ market, cost_per_1000: undefined })).cmp.hasMarket()).toBeFalse();
    });

    it('рынок не приехал — блока нет', () => {
      expect(setup(overview()).cmp.hasMarket()).toBeFalse();
    });

    it('кратность — с запятой, и слово при ней по-русски', () => {
      const { cmp } = setup(overview({ market }));
      expect(cmp.times(17.9)).toBe('17,9');
      expect(cmp.timesWord(17.9)).toBe('раза');
      expect(cmp.times(2)).toBe('2');
      expect(cmp.timesWord(2)).toBe('раза');
      expect(cmp.timesWord(5)).toBe('раз');
    });
  });

  /**
   * График рисует линию, а не столбики: просмотры — величина
   * непрерывная, и от графика ждут формы роста, а не набора палок.
   *
   * Геометрию и разрывы считает общий app-line-chart (его разбор ряда
   * проверяет chart-series.spec.ts) — здесь остаётся ровно то, за что
   * отвечает сводка: какой ряд она в этот график отдаёт.
   */
  describe('график прироста', () => {
    const series = [
      { date: '2026-09-10', views_gained: 40_000 },
      // День без выкладок. Сглаживать его нельзя: провал — это факт, а
      // ноль между двумя удачными днями и есть тот вопрос, ради которого
      // на график смотрят.
      { date: '2026-09-11', views_gained: 0 },
      { date: '2026-09-12', views_gained: 20_000 },
    ];

    it('в график уходит прирост за день, а не накопленный итог', () => {
      const pts = setup(overview({ series })).cmp.chartPoints();
      expect(pts.map((p) => p.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
      expect(pts.map((p) => p.value)).toEqual([40_000, 0, 20_000]);
    });

    /**
     * Ноль просмотров и «в этот день не собирали» — разные вещи. Ноль
     * измерен, и подменять его дырой нельзя: это тоже ответ.
     */
    it('нулевой день остаётся нулём, а не выбрасывается из ряда', () => {
      const pts = setup(overview({ series })).cmp.chartPoints();
      expect(pts.length).toBe(3);
      expect(pts[1].value).toBe(0);
    });

    it('лучший день — максимум прироста, а не последний', () => {
      expect(setup(overview({ series })).cmp.bestDay()?.date).toBe('2026-09-10');
    });

    it('ряд из одних нулей графика не даёт: рисовать нечего', () => {
      const flat = [
        { date: '2026-09-10', views_gained: 0 },
        { date: '2026-09-11', views_gained: 0 },
      ];
      expect(setup(overview({ series: flat })).cmp.hasChart()).toBeFalse();
    });
  });

  it('идущие проекты идут перед не начавшимися', () => {
    const { cmp } = setup(
      overview({
        projects: [
          { project_id: 'a', title: 'Не начали', state: 'not_started', views: 0, total: 0 },
          { project_id: 'b', title: 'Идёт', state: 'running', views: 10, total: 100 },
        ],
      }),
    );
    expect(cmp.projects().map((p) => p.title)).toEqual(['Идёт', 'Не начали']);
  });

  /**
   * Сводка стоит НАД списком проектов. Красная плашка поверх него пугает
   * сильнее, чем помогает: сами проекты при этом открываются и работают.
   */
  it('не доехало — блока просто нет, без плашки поверх проектов', () => {
    const { cmp } = setup(null);
    expect(cmp.failed()).toBeTrue();
    expect(cmp.loading()).toBeFalse();
  });

  it('проектов нет — сводке нечего сводить', () => {
    expect(setup(overview({ projects_total: 0 })).cmp.hasProjects()).toBeFalse();
  });
});
