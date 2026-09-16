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
   * Реестр проектов — ОДИН на обе вкладки кабинета.
   *
   * Было два списка про одно и то же: «Итоги по завершённым проектам»
   * под дашбордом и карточки идущих проектов во вкладке «Проекты». В
   * первом стояли просмотры, счёт и цена тысячи, во втором — проценты
   * воронки и бейдж «Впереди», которых у проекта с креаторами нет вовсе:
   * «100 %» висело у проекта без единого вышедшего ролика.
   *
   * Теперь список один и отвечает на один вопрос по всем проектам.
   * Состояние приходит с сервера отдельным полем: выводить завершённость
   * в браузере по косвенным приметам («период закрыт и новый не
   * начался») значило бы завести вторую версию правды, которая
   * разойдётся с первой молча.
   */
  describe('реестр проектов', () => {
    const mixed = [
      { project_id: 'a', title: 'Не начали', state: 'not_started' as const, views: 0, total: 0 },
      { project_id: 'b', title: 'Идёт', state: 'running' as const, views: 10, total: 100 },
      {
        project_id: 'c',
        title: 'Сдан в мае',
        state: 'completed' as const,
        completed_at: '2026-05-20T00:00:00Z',
        views: 50,
        total: 500,
      },
      {
        project_id: 'd',
        title: 'Сдан в августе',
        state: 'completed' as const,
        completed_at: '2026-08-20T00:00:00Z',
        views: 70,
        total: 700,
      },
    ];

    /**
     * Идущие первыми: незаконченный проект — то, о чём спрашивают
     * сегодня, а сданный смотрят, когда приходят за следующим заказом.
     */
    it('идущие сверху, сданные внизу, внутри — по объёму', () => {
      const { cmp } = setup(overview({ projects: mixed }));
      expect(cmp.projects().map((p) => p.title)).toEqual([
        'Идёт',
        'Не начали',
        'Сдан в августе',
        'Сдан в мае',
      ]);
    });

    /**
     * Проектов нет — реестра нет вовсе. Пустой список с заголовком
     * «Проекты» читается как «проекты потерялись», а ноль в его итогах —
     * как «работали и ничего не собрали».
     */
    it('проектов нет — реестра нет вовсе, а не пустые строки', () => {
      expect(setup(overview({ projects: [] })).cmp.projects().length).toBe(0);
    });

    /**
     * Период подписывается ДАТАМИ и только когда он есть: он
     * отсчитывается от первой публикации, а не от календаря и не от
     * заведения проекта. Выдуманная дата хуже отсутствующей — по ней
     * начинают считать сроки.
     */
    it('периода нет — вместо дат сказано, с чего он начнётся', () => {
      const { cmp } = setup(overview({ projects: mixed }));
      const [notStarted] = mixed;
      expect(cmp.periodOf(notStarted)).toBe('Период начнётся с первого вышедшего ролика');
    });

    it('сданный подписан датой сдачи, а не периодом', () => {
      const { cmp } = setup(overview({ projects: mixed }));
      expect(cmp.periodOf(mixed[3])).toBe('Сдан 20 августа 2026');
    });

    /** Три состояния, и путать их нельзя: «идёт» у сданного — неправда. */
    it('состояние называется словом, и все три разные', () => {
      const { cmp } = setup(overview({ projects: mixed }));
      expect(mixed.map((p) => cmp.stateLabel(p))).toEqual(['Готовится', 'Идёт', 'Сдан', 'Сдан']);
    });
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
