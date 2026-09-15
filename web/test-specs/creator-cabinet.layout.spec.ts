import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type {
  Accrual,
  CreatorEarnings,
  CreatorPeriod,
} from '@entities/billing/model/billing.types';
import type { Publication, PublicationReport } from '@entities/publication/model/publication.types';
import { CreatorHighlightsComponent } from '@widgets/creator-highlights/creator-highlights.component';
import { CreatorHistoryComponent } from '@widgets/creator-history/creator-history.component';
import { CreatorLadderComponent } from '@widgets/creator-ladder/creator-ladder.component';

/**
 * Кабинет креатора рисуется в настоящем браузере и меряется линейкой.
 *
 * Блок площадок назывался `.plat` — и получал от глобального словаря
 * .crm-page чужие правила: там `.plat` это значок площадки 30×26 с
 * display:grid. Коробка схлопывалась в значок, а заголовок, полоски и
 * подписи «11 роликов · 4,4 млн всего» продолжали рисоваться — поверх
 * списка «Мои выкладки» и поверх строки «что делать дальше». То же
 * самое ждало `.plist` и `.lbl`.
 *
 * Глазами это видно только на снимке в нужную ширину, а на глаз мы
 * смотрим не после каждой правки. Поэтому — геометрией: всё, что есть в
 * карточке, обязано лежать внутри её рамки.
 *
 * Компоненты рендерятся ВНУТРИ .crm-page, иначе проверка ничего не
 * стоит: именно оттуда приходят чужие правила, и без этой обёртки
 * сломанная вёрстка выглядела бы целой.
 */
describe('кабинет креатора: блоки не текут за свои рамки', () => {
  const PERIOD: CreatorPeriod = {
    seq: 3,
    starts_on: '2026-09-01T00:00:00Z',
    ends_on: '2026-09-30T00:00:00Z',
    status: 'open',
    carry_in_creator: 12_000,
    carry_out_creator: 0,
  };

  const CLOSED: CreatorPeriod[] = [
    {
      seq: 1,
      starts_on: '2026-07-01T00:00:00Z',
      ends_on: '2026-07-31T00:00:00Z',
      status: 'locked',
      carry_in_creator: 0,
      carry_out_creator: 0,
    },
    {
      seq: 2,
      starts_on: '2026-08-01T00:00:00Z',
      ends_on: '2026-08-31T00:00:00Z',
      status: 'locked',
      carry_in_creator: 0,
      carry_out_creator: 0,
    },
  ];

  function accrual(periodStart: string, views: number, total: number): Accrual {
    return {
      id: periodStart,
      project_id: 'pr1',
      creator_user_id: 'c1',
      period_start: periodStart,
      status: 'paid',
      salary: total - 40_000,
      views_base: views,
      views_over: 0,
      views_total: views,
      views_bonus: 40_000,
      clicks: 0,
      click_bonus: 0,
      videos_planned: 12,
      videos_delivered: 11,
      deduction: 25_000,
      total,
    };
  }

  function earnings(): CreatorEarnings {
    return {
      period: PERIOD,
      periods: [...CLOSED, PERIOD],
      accruals: [
        accrual('2026-07-01T00:00:00Z', 1_200_000, 6_000_000),
        accrual('2026-08-01T00:00:00Z', 4_400_000, 9_500_000),
        accrual('2026-09-01T00:00:00Z', 380_000, 2_100_000),
      ],
      benchmark: {
        typical_video_views: 18_000,
        typical_video_source: 'creator',
        my_percentile: 88,
      },
      next_step_forecast: {
        step_views: 100_000,
        views_to_go: 100_000,
        carry_in_included: 12_000,
        forecast_payout: 356_400,
      },
      terms: {
        project_id: 'pr1',
        salary_per_month: 6_000_000,
        rate_per_1000_views: 1200,
        rate_per_1000_views_over: 600,
        bonus_views_threshold: 1_000_000,
      },
    };
  }

  function pub(id: string, views: number, published: string, title: string): Publication {
    return {
      id,
      project_id: 'pr1',
      creator_user_id: 'c1',
      title,
      due_date: published,
      status: 'done',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      links: [],
      overdue: false,
      views,
      likes: 0,
      comments: 0,
      published_at: published,
    };
  }

  // Длинные названия и крупные числа намеренно: узкая колонка с коротким
  // текстом не течёт даже когда сломана.
  const PUBS: Publication[] = [
    pub('a', 240_000, '2026-09-04T00:00:00Z', 'Распаковка корма и первая реакция кота на банку'),
    pub('b', 90_000, '2026-09-11T00:00:00Z', 'Утро с котом: что он делает, пока вы спите'),
    pub('c', 41_000, '2026-09-18T00:00:00Z', 'Три ошибки, из-за которых кот не ест сухой корм'),
    pub('d', 1_900_000, '2026-07-06T00:00:00Z', 'Тот самый ролик, который выстрелил в июле'),
  ];

  const REPORT: PublicationReport = {
    project_id: 'pr1',
    as_of: '2026-09-20T00:00:00Z',
    videos: 11,
    views: 4_400_000,
    likes: 120_000,
    comments: 9000,
    growth_24h: 12_000,
    collapsed: false,
    by_day: [],
    by_creator: [],
    videos_table: [],
    by_platform: [
      { platform: 'tiktok', videos: 11, views: 4_400_000, likes: 90_000, comments: 7000 },
      { platform: 'youtube', videos: 9, views: 900_000, likes: 20_000, comments: 1500 },
      { platform: 'vk', videos: 11, views: 610_000, likes: 8000, comments: 400 },
      { platform: 'likee', videos: 4, views: 70_000, likes: 2000, comments: 100 },
    ],
  };

  /**
   * Ширина колонки кабинета: .shell.solo это 1080 минус горизонтальные
   * поля. На 1440 экрана получается ровно она — та самая ширина, на
   * которой блок и наезжал.
   */
  const COLUMN_WIDTH = 1016;

  let wrapper: HTMLElement | null = null;

  afterEach(() => {
    wrapper?.remove();
    wrapper = null;
  });

  /**
   * Собирает то же окружение, что на странице: .crm-page вокруг и
   * колонка фиксированной ширины. Без .crm-page глобальные правила не
   * доедут, и спека будет проверять другую вёрстку, а не нашу.
   */
  function mount<T>(type: Type<T>, inputs: Record<string, unknown>): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(type);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();

    wrapper = document.createElement('div');
    wrapper.className = 'crm-page';
    const main = document.createElement('div');
    main.className = 'main';
    main.style.width = `${COLUMN_WIDTH}px`;
    wrapper.appendChild(main);
    document.body.appendChild(wrapper);
    main.appendChild(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();
    return main;
  }

  /**
   * Всё, что лежит в коробке, обязано лежать в её границах.
   *
   * Полпикселя допуска — субпиксельная раскладка на дробных размерах, а
   * не протёкший наружу элемент.
   */
  function expectInside(box: HTMLElement, what: string): void {
    const outer = box.getBoundingClientRect();
    expect(outer.height).withContext(`${what}: коробка схлопнулась`).toBeGreaterThan(0);
    for (const child of Array.from(box.querySelectorAll<HTMLElement>('*'))) {
      const c = child.getBoundingClientRect();
      const where = `${what} → .${child.className || child.tagName.toLowerCase()}`;
      expect(c.bottom)
        .withContext(`${where}: вылез снизу`)
        .toBeLessThanOrEqual(outer.bottom + 0.5);
      expect(c.right)
        .withContext(`${where}: вылез справа`)
        .toBeLessThanOrEqual(outer.right + 0.5);
    }
  }

  describe('достижения', () => {
    function render(): HTMLElement {
      return mount(CreatorHighlightsComponent, {
        earnings: earnings(),
        publications: PUBS,
        report: REPORT,
      });
    }

    it('всё содержимое лежит внутри карточки', () => {
      const card = render().querySelector<HTMLElement>('.hl')!;
      expect(card).not.toBeNull();
      expectInside(card, 'карточка достижений');
    });

    /**
     * Та самая коробка, которая схлопывалась в значок площадки 30×26.
     * Проверяем её отдельно и по имени: именно здесь ломалось, и по
     * упавшей строке должно быть сразу видно, что ломается снова.
     */
    it('блок площадок держит свои строки, а не схлопывается в значок', () => {
      const plats = render().querySelector<HTMLElement>('.hl-plats')!;
      expect(plats).not.toBeNull();
      const rows = plats.querySelectorAll('.hl-rows li');
      expect(rows.length).toBe(4);
      // Четыре строки с подписями не помещаются в тридцать пикселей ни
      // при какой вёрстке — значит, коробка живая.
      expect(plats.getBoundingClientRect().height).toBeGreaterThan(80);
      expectInside(plats, 'блок площадок');
    });

    it('плитки рекордов не наезжают друг на друга', () => {
      const recs = Array.from(render().querySelectorAll<HTMLElement>('.rec'));
      expect(recs.length).toBeGreaterThan(1);
      for (const rec of recs) expectInside(rec, 'плитка рекорда');
    });
  });

  describe('история периодов', () => {
    it('всё содержимое лежит внутри карточки', () => {
      const card = mount(CreatorHistoryComponent, {
        earnings: earnings(),
      }).querySelector<HTMLElement>('.hist')!;
      expect(card).not.toBeNull();
      expect(card.querySelectorAll('.ph-rows li').length).toBe(2);
      expectInside(card, 'карточка истории');
    });
  });

  describe('заработок за период', () => {
    it('всё содержимое лежит внутри карточки', () => {
      const card = mount(CreatorLadderComponent, {
        earnings: earnings(),
        publications: PUBS,
      }).querySelector<HTMLElement>('.ladder')!;
      expect(card).not.toBeNull();
      expectInside(card, 'карточка заработка');
    });
  });
});
