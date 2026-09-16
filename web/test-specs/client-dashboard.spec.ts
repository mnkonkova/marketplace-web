import { TestBed } from '@angular/core/testing';

import type { ClientOverview, OverviewPlatform } from '@entities/billing/model/billing.types';
import { ClientDashboardComponent } from '@widgets/client-dashboard/client-dashboard.component';

/**
 * Главный график дашборда заказчика.
 *
 * Над графиком стоит итог за окно, и линия обязана показывать ТУ ЖЕ
 * величину. Раньше она показывала поденный прирост: он естественно
 * затухает — ролик выстреливает и остывает, — и под числом-итогом такая
 * линия читалась как падение самого итога. Прятали это порогом «короче
 * недели не рисуем», отчего на новом проекте графика не было вовсе.
 *
 * Теперь линия накопительная: она не умеет идти вниз и приходит ровно в
 * то число, что стоит сверху. Здесь сторожим оба конца этого правила —
 * и что накопление считается, и что оно сходится с итогом.
 */
describe('ClientDashboardComponent: график', () => {
  function platform(over: Partial<OverviewPlatform> = {}): OverviewPlatform {
    return {
      platform: 'tiktok',
      views: 0,
      share_pct: 0,
      window_views: 0,
      series: [],
      ...over,
    };
  }

  function data(platforms: OverviewPlatform[]): ClientOverview {
    return {
      projects_total: 1,
      projects: [],
      views: { total: 0, by_platform: {} },
      money: { locked: 0, current: 0, total: 0, paid: 0 },
      series: [],
      platforms,
      generated_at: '2026-09-14T00:00:00Z',
    } as unknown as ClientOverview;
  }

  function setup(platforms: OverviewPlatform[]): ClientDashboardComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(ClientDashboardComponent, { set: { template: '' } });
    const f = TestBed.createComponent(ClientDashboardComponent);
    f.componentRef.setInput('data', data(platforms));
    f.componentRef.setInput('range', 'month');
    f.detectChanges();
    return f.componentInstance;
  }

  const tiktok = platform({
    platform: 'tiktok',
    series: [
      { date: '2026-09-10', views_gained: 40_000 },
      { date: '2026-09-11', views_gained: 0 },
      { date: '2026-09-12', views_gained: 20_000 },
    ],
  });

  it('линия накопительная и приходит в сумму прироста за окно', () => {
    const cmp = setup([tiktok]);
    const line = cmp.chartSeries()[0];
    expect(line.points.map((p) => p.value)).toEqual([40_000, 40_000, 60_000]);
  });

  /**
   * Ноль просмотров и «в этот день не собирали» — разные вещи. Ноль
   * измерен, и подменять его дырой нельзя: на накопительной линии он
   * даёт ровный участок, а не разрыв.
   */
  it('нулевой день остаётся в ряду, а не выбрасывается', () => {
    const pts = setup([tiktok]).chartSeries()[0].points;
    expect(pts.length).toBe(3);
    expect(pts[1].value).toBe(pts[0].value);
  });

  /**
   * Подпись «лучший день» считается по ПРИРОСТУ. У накопительной линии
   * максимум всегда в последней точке, и подпись превратилась бы в
   * «лучший день — всегда сегодня».
   */
  it('лучший день — когда выстрелило, а не последний день окна', () => {
    expect(setup([tiktok]).bestDay()?.date).toBe('2026-09-10');
  });

  it('несколько площадок — своя линия у каждой плюс общая поверх', () => {
    const cmp = setup([
      tiktok,
      platform({
        platform: 'vk',
        series: [
          { date: '2026-09-10', views_gained: 1_000 },
          { date: '2026-09-11', views_gained: 1_000 },
          { date: '2026-09-12', views_gained: 1_000 },
        ],
      }),
    ]);
    const keys = cmp.chartSeries().map((s) => s.key);
    expect(keys).toEqual(['tiktok', 'vk', 'all']);

    // Общая — сумма тех же слагаемых, а не отдельный ряд с сервера:
    // разойдись она с суммой, и заказчик увидел бы под графиком число,
    // которого нет ни на одной линии.
    const all = cmp.chartSeries().find((s) => s.key === 'all')!;
    expect(all.points[all.points.length - 1].value).toBe(60_000 + 3_000);
  });

  it('площадка одна — второй линии по тем же точкам не рисуем', () => {
    expect(
      setup([tiktok])
        .chartSeries()
        .map((s) => s.key),
    ).toEqual(['tiktok']);
  });

  /**
   * Из одной точки линии не выходит. Это единственное оставшееся
   * ограничение по длине ряда: прежний порог в неделю прятал падающую
   * линию, а накопительной прятать нечего.
   */
  it('ряда короче двух дней в графике нет', () => {
    const cmp = setup([
      platform({ platform: 'tiktok', series: [{ date: '2026-09-12', views_gained: 10 }] }),
    ]);
    expect(cmp.chartSeries().length).toBe(0);
    expect(cmp.hasChart()).toBeFalse();
  });
});
