import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { ClientOverview } from '@entities/billing/model/billing.types';
import { ClientOverviewComponent } from '@widgets/client-overview/client-overview.component';

/**
 * Сводка заказчика по всем проектам.
 *
 * Считает здесь только то, что нельзя посчитать на сервере, — геометрию
 * графика и раскладку площадок. Суммы, стоимость тысячи и сам ряд
 * приходят готовыми: второй расчёт дал бы на двух экранах два разных
 * числа.
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

  function setup(data: ClientOverview | null) {
    TestBed.resetTestingModule();
    const api = {
      clientOverview: () => (data ? of(data) : throwError(() => new Error('нет связи'))),
    };
    TestBed.configureTestingModule({ providers: [{ provide: BillingApi, useValue: api }] });
    TestBed.overrideComponent(ClientOverviewComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ClientOverviewComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /**
   * Пропавший столбик читается как сбой, а не как ноль: человек ищет,
   * куда делся Likee, вместо того чтобы прочитать «на Likee пока ничего».
   */
  it('площадок всегда пять, включая те, где ничего нет', () => {
    const rows = setup(overview()).platforms();
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.platform)).toEqual(['tiktok', 'instagram', 'youtube', 'vk', 'likee']);
    const likee = rows.find((r) => r.platform === 'likee')!;
    expect(likee.views).toBe(0);
    expect(likee.percent).toBe(0);
  });

  it('полоска площадки считается от лучшей, а не от суммы', () => {
    const rows = setup(overview()).platforms();
    expect(rows.find((r) => r.platform === 'tiktok')!.percent).toBe(100);
    expect(rows.find((r) => r.platform === 'instagram')!.percent).toBe(25);
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
      const pts = setup(overview({ series })).chartPoints();
      expect(pts.map((p) => p.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
      expect(pts.map((p) => p.value)).toEqual([40_000, 0, 20_000]);
    });

    /**
     * Ноль просмотров и «в этот день не собирали» — разные вещи. Ноль
     * измерен, и подменять его дырой нельзя: это тоже ответ.
     */
    it('нулевой день остаётся нулём, а не выбрасывается из ряда', () => {
      const pts = setup(overview({ series })).chartPoints();
      expect(pts.length).toBe(3);
      expect(pts[1].value).toBe(0);
    });

    it('лучший день — максимум прироста, а не последний', () => {
      expect(setup(overview({ series })).bestDay()?.date).toBe('2026-09-10');
    });

    it('ряд из одних нулей графика не даёт: рисовать нечего', () => {
      const flat = [
        { date: '2026-09-10', views_gained: 0 },
        { date: '2026-09-11', views_gained: 0 },
      ];
      expect(setup(overview({ series: flat })).hasChart()).toBeFalse();
    });
  });

  it('идущие проекты идут перед не начавшимися', () => {
    const cmp = setup(
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
    const cmp = setup(null);
    expect(cmp.failed()).toBeTrue();
    expect(cmp.loading()).toBeFalse();
  });

  it('проектов нет — сводке нечего сводить', () => {
    expect(setup(overview({ projects_total: 0 })).hasProjects()).toBeFalse();
  });
});
