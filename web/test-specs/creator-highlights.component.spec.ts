import { TestBed } from '@angular/core/testing';

import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import type { Publication, PublicationReport } from '@entities/publication/model/publication.types';
import { CreatorHighlightsComponent } from '@widgets/creator-highlights/creator-highlights.component';

/**
 * Блок достижений: что он показывает и — важнее — чего не показывает.
 *
 * Арифметику проверяет creator-highlights.spec; здесь то, что живёт в
 * компоненте: находится ли рекорд среди своих выкладок, не поздравляет
 * ли экран с пустотой и приходит ли обезличенное сравнение только
 * тогда, когда его прислал сервер.
 */
describe('CreatorHighlightsComponent', () => {
  const PERIOD = {
    seq: 2,
    starts_on: '2026-09-01T00:00:00Z',
    ends_on: '2026-09-30T00:00:00Z',
    status: 'open' as const,
    carry_in_creator: 0,
    carry_out_creator: 0,
  };

  function earnings(over: Partial<CreatorEarnings> = {}): CreatorEarnings {
    return { period: PERIOD, periods: [PERIOD], ...over };
  }

  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: over.id ?? 'p1',
      project_id: 'pr1',
      creator_user_id: 'c1',
      due_date: '2026-09-10T00:00:00Z',
      status: 'done',
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

  function report(over: Partial<PublicationReport> = {}): PublicationReport {
    return {
      project_id: 'pr1',
      as_of: '2026-09-20T00:00:00Z',
      videos: 0,
      views: 0,
      likes: 0,
      comments: 0,
      growth_24h: 0,
      collapsed: false,
      by_day: [],
      by_platform: [],
      by_creator: [],
      videos_table: [],
      ...over,
    };
  }

  function setup(
    e: CreatorEarnings | null,
    pubs: Publication[] = [],
    rep: PublicationReport | null = null,
  ) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(CreatorHighlightsComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorHighlightsComponent);
    fixture.componentRef.setInput('earnings', e);
    fixture.componentRef.setInput('publications', pubs);
    fixture.componentRef.setInput('report', rep);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /**
   * Пустой проект не хвалят. Ровно эту ошибку мы чинили в зелёном
   * значке «всё сдано»: он поздравлял с ничем.
   */
  it('без единого вышедшего ролика блока нет', () => {
    const cmp = setup(earnings(), [pub({ views: 0 })]);
    expect(cmp.hasAnything()).toBeFalse();
    expect(cmp.bestEver()).toBeNull();
  });

  it('рекорд периода и рекорд проекта — разные ролики', () => {
    const cmp = setup(earnings(), [
      pub({ id: 'old', views: 300_000, published_at: '2026-07-10T00:00:00Z' }),
      pub({ id: 'now', views: 40_000, published_at: '2026-09-10T00:00:00Z' }),
    ]);
    expect(cmp.bestOfPeriod()?.id).toBe('now');
    expect(cmp.bestEver()?.id).toBe('old');
    expect(cmp.bestIsRecord()).toBeFalse();
  });

  /** Один и тот же ролик в двух плитках читался бы как ошибка вёрстки. */
  it('лучший ролик периода он же рекорд проекта — говорим один раз', () => {
    const cmp = setup(earnings(), [
      pub({ id: 'old', views: 10_000, published_at: '2026-07-10T00:00:00Z' }),
      pub({ id: 'now', views: 90_000, published_at: '2026-09-10T00:00:00Z' }),
    ]);
    expect(cmp.bestIsRecord()).toBeTrue();
  });

  it('отменённая выкладка рекордом не становится', () => {
    const cmp = setup(earnings(), [
      pub({ id: 'x', views: 500_000, published_at: '2026-09-05T00:00:00Z', status: 'cancelled' }),
    ]);
    expect(cmp.hasAnything()).toBeFalse();
  });

  it('разрез по площадкам берётся из отчёта', () => {
    const cmp = setup(
      earnings(),
      [pub({ id: 'a', views: 80_000, published_at: '2026-09-05T00:00:00Z' })],
      report({
        by_platform: [
          { platform: 'tiktok', videos: 2, views: 60_000, likes: 0, comments: 0 },
          { platform: 'vk', videos: 2, views: 20_000, likes: 0, comments: 0 },
        ],
      }),
    );
    expect(cmp.platforms().length).toBe(2);
    expect(cmp.lead()?.best.platform).toBe('tiktok');
  });

  it('отчёта нет — разреза по площадкам тоже нет', () => {
    const cmp = setup(earnings(), [
      pub({ id: 'a', views: 80_000, published_at: '2026-09-05T00:00:00Z' }),
    ]);
    expect(cmp.platforms()).toEqual([]);
    expect(cmp.lead()).toBeNull();
  });

  /**
   * У сравнения свой порог обезличивания: ниже него «медиана проекта» —
   * это результат соседа, а не агрегат. Сервер тогда не присылает
   * процентиль вовсе, и блока быть не должно — без объяснений и пустого
   * места.
   */
  it('процентиль не пришёл — сравнения нет', () => {
    const cmp = setup(
      earnings({ benchmark: { typical_video_views: 3000, typical_video_source: 'project' } }),
    );
    expect(cmp.topPercent()).toBeNull();
  });

  it('процентиль пришёл — считаем «в топ-N%» от него', () => {
    const cmp = setup(
      earnings({
        benchmark: {
          typical_video_views: 3000,
          typical_video_source: 'creator',
          my_percentile: 82,
        },
      }),
    );
    expect(cmp.topPercent()).toBe(18);
  });
});
