import {
  MIN_PLATFORM_LEAD,
  PROFILE_PLATFORMS,
  bestVideo,
  earnedTotal,
  missingAccountLinks,
  nextStepKind,
  periodHistory,
  platformLead,
  platformStats,
  videosInPeriod,
  viewsTrend,
} from '@entities/billing/lib/creator-highlights';
import type { Accrual, CreatorPeriod } from '@entities/billing/model/billing.types';
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import type { PlatformRow } from '@entities/publication/model/publication.types';

/**
 * Достижения креатора: рекорды, площадки, рост от периода к периоду.
 *
 * Половина этих проверок — про то, чего экран НЕ должен сказать. Пустой
 * рекорд, лидера среди одной площадки, рост из одной точки, падение на
 * пятый день идущего периода: каждое из них — выдуманная мотивация,
 * а это ровно та ошибка, за которую кабинет перестают открывать.
 */
describe('creator-highlights', () => {
  function video(over: Partial<{ id: string; views: number; published_at: string }> = {}) {
    return {
      id: over.id ?? 'v1',
      views: over.views ?? 0,
      published_at: over.published_at,
    };
  }

  describe('ролики периода', () => {
    const period = { starts_on: '2026-09-01T00:00:00Z', ends_on: '2026-09-30T00:00:00Z' };

    it('границы включительны с обеих сторон', () => {
      const got = videosInPeriod(
        [
          video({ id: 'first', published_at: '2026-09-01T23:00:00Z' }),
          video({ id: 'last', published_at: '2026-09-30T05:00:00Z' }),
        ],
        period,
      );
      expect(got.map((v) => v.id)).toEqual(['first', 'last']);
    });

    it('соседние периоды не захватываются', () => {
      const got = videosInPeriod(
        [
          video({ id: 'before', published_at: '2026-08-31T23:00:00Z' }),
          video({ id: 'after', published_at: '2026-10-01T01:00:00Z' }),
        ],
        period,
      );
      expect(got).toEqual([]);
    });

    /**
     * Дата выхода — единственный признак, по которому ролик попадает в
     * период. Без неё возраст ролика неизвестен, а на возрасте стоит и
     * «зрелый», и «ещё растёт».
     */
    it('ролик без даты выхода в период не попадает', () => {
      expect(videosInPeriod([video({ id: 'x' })], period)).toEqual([]);
    });

    it('без периода отбирать не по чему', () => {
      expect(videosInPeriod([video({ published_at: '2026-09-10T00:00:00Z' })], null)).toEqual([]);
    });
  });

  describe('лучший ролик', () => {
    it('берётся максимум по просмотрам', () => {
      const best = bestVideo([
        video({ id: 'a', views: 12_000 }),
        video({ id: 'b', views: 48_000 }),
        video({ id: 'c', views: 3_000 }),
      ]);
      expect(best?.id).toBe('b');
    });

    /**
     * Ноль — не рекорд. «Твой лучший ролик — 0 просмотров» это
     * поздравление с ничем, ровно как зелёный значок «всё сдано» на
     * пустом проекте.
     */
    it('нули рекордом не считаются', () => {
      expect(bestVideo([video({ views: 0 }), video({ id: 'b', views: 0 })])).toBeNull();
      expect(bestVideo([])).toBeNull();
    });
  });

  describe('сильнейшая площадка', () => {
    function row(over: Partial<PlatformRow>): PlatformRow {
      return {
        platform: over.platform ?? 'tiktok',
        videos: over.videos ?? 0,
        views: over.views ?? 0,
        likes: 0,
        comments: 0,
      };
    }

    /**
     * Сравниваем просмотрами НА РОЛИК: по сумме площадка с шестью
     * роликами обгонит площадку с двумя просто числом роликов, и
     * «сильнее всего» показывало бы, куда чаще досылают ссылки.
     */
    it('сравнение идёт по просмотрам на ролик, а не по сумме', () => {
      const stats = platformStats([
        row({ platform: 'tiktok', videos: 10, views: 100_000 }),
        row({ platform: 'youtube', videos: 2, views: 60_000 }),
      ]);
      expect(stats.map((s) => s.platform)).toEqual(['youtube', 'tiktok']);
      expect(stats[0].perVideo).toBe(30_000);
      expect(stats[1].perVideo).toBe(10_000);
      expect(stats[0].percent).toBe(100);
      expect(stats[1].percent).toBe(33);
    });

    it('площадки без роликов в разрез не попадают', () => {
      const stats = platformStats([
        row({ platform: 'tiktok', videos: 3, views: 30_000 }),
        row({ platform: 'likee', videos: 0, views: 0 }),
      ]);
      expect(stats.map((s) => s.platform)).toEqual(['tiktok']);
    });

    it('одна площадка — лидера нет: сравнивать не с чем', () => {
      const stats = platformStats([row({ platform: 'tiktok', videos: 3, views: 30_000 })]);
      expect(platformLead(stats)).toBeNull();
    });

    /**
     * Разница в несколько процентов — это разброс, а не сила. Назвать её
     * преимуществом значит выдать случайность за достижение: человек
     * начнёт подстраивать работу под число, которого нет.
     */
    it('вровень идущие площадки лидера не дают', () => {
      const stats = platformStats([
        row({ platform: 'tiktok', videos: 2, views: 21_000 }),
        row({ platform: 'vk', videos: 2, views: 20_000 }),
      ]);
      expect(platformLead(stats)).toBeNull();
    });

    it('обгон больше порога — лидер есть', () => {
      const stats = platformStats([
        row({ platform: 'tiktok', videos: 2, views: 60_000 }),
        row({ platform: 'vk', videos: 2, views: 20_000 }),
      ]);
      const lead = platformLead(stats);
      expect(lead?.best.platform).toBe('tiktok');
      expect(lead?.runnerUp.platform).toBe('vk');
      expect(lead?.times).toBeGreaterThanOrEqual(MIN_PLATFORM_LEAD);
    });
  });

  describe('история периодов', () => {
    function period(seq: number, from: string, to: string, open = false): CreatorPeriod {
      return {
        seq,
        starts_on: from,
        ends_on: to,
        status: open ? 'open' : 'locked',
        carry_in_creator: 0,
        carry_out_creator: 0,
      };
    }

    function accrual(over: Partial<Accrual> & { period_start: string }): Accrual {
      return {
        id: over.id ?? over.period_start,
        project_id: 'pr1',
        creator_user_id: 'c1',
        status: 'approved',
        salary: 0,
        views_base: 0,
        views_over: 0,
        views_total: 0,
        views_bonus: 0,
        clicks: 0,
        click_bonus: 0,
        videos_planned: 0,
        videos_delivered: 0,
        deduction: 0,
        total: 0,
        ...over,
      };
    }

    const periods = [
      period(1, '2026-07-01T00:00:00Z', '2026-07-31T00:00:00Z'),
      period(2, '2026-08-01T00:00:00Z', '2026-08-31T00:00:00Z'),
      period(3, '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z', true),
    ];

    const accruals = [
      accrual({ period_start: '2026-07-01T00:00:00Z', views_total: 100_000, total: 5_000_00 }),
      accrual({ period_start: '2026-08-01T00:00:00Z', views_total: 150_000, total: 7_000_00 }),
      accrual({ period_start: '2026-09-01T00:00:00Z', views_total: 20_000, total: 1_000_00 }),
    ];

    it('свежие периоды первыми', () => {
      const rows = periodHistory(accruals, periods);
      expect(rows.map((r) => r.periodStart.slice(0, 7))).toEqual(['2026-09', '2026-08', '2026-07']);
    });

    it('рост считается от предыдущего законченного периода', () => {
      const rows = periodHistory(accruals, periods);
      const august = rows.find((r) => r.periodStart.startsWith('2026-08'));
      expect(august?.viewsDelta).toBe(50_000);
      expect(august?.viewsDeltaPercent).toBe(50);
    });

    /**
     * Идущий период против законченного — сравнение половины с целым.
     * «Просмотры упали» на пятый день периода было бы неправдой, и
     * неправдой обидной.
     */
    it('идущий период с прошлым не сравнивается', () => {
      const rows = periodHistory(accruals, periods);
      const september = rows.find((r) => r.periodStart.startsWith('2026-09'));
      expect(september?.open).toBeTrue();
      expect(september?.viewsDelta).toBeNull();
    });

    it('первому периоду сравнивать не с чем', () => {
      const rows = periodHistory(accruals, periods);
      expect(rows.find((r) => r.periodStart.startsWith('2026-07'))?.viewsDelta).toBeNull();
    });

    /** Просмотры упали — так и говорим. Отрицательная дельта, а не молчание. */
    it('падение показывается падением', () => {
      const rows = periodHistory(
        [
          accrual({ period_start: '2026-07-01T00:00:00Z', views_total: 200_000 }),
          accrual({ period_start: '2026-08-01T00:00:00Z', views_total: 120_000 }),
        ],
        periods,
      );
      const august = rows.find((r) => r.periodStart.startsWith('2026-08'));
      expect(august?.viewsDelta).toBe(-80_000);
      expect(august?.viewsDeltaPercent).toBe(-40);
    });

    // Делить не на что: «рост на 100%» с нуля — фраза ни о чём.
    it('после пустого периода процента нет, а разница есть', () => {
      const rows = periodHistory(
        [
          accrual({ period_start: '2026-07-01T00:00:00Z', views_total: 0 }),
          accrual({ period_start: '2026-08-01T00:00:00Z', views_total: 30_000 }),
        ],
        periods,
      );
      const august = rows.find((r) => r.periodStart.startsWith('2026-08'));
      expect(august?.viewsDelta).toBe(30_000);
      expect(august?.viewsDeltaPercent).toBeNull();
    });

    it('тренд — по двум последним законченным периодам', () => {
      const trend = viewsTrend(periodHistory(accruals, periods));
      expect(trend?.direction).toBe('up');
      expect(trend?.views).toBe(150_000);
      expect(trend?.prevViews).toBe(100_000);
    });

    /** Тренда из одной точки не бывает — и рисовать его нечем. */
    it('один законченный период тренда не даёт', () => {
      const rows = periodHistory([accruals[0], accruals[2]], periods);
      expect(viewsTrend(rows)).toBeNull();
    });

    it('в сумму за проект идут только законченные периоды', () => {
      const { total, periods: count } = earnedTotal(periodHistory(accruals, periods));
      expect(count).toBe(2);
      expect(total).toBe(5_000_00 + 7_000_00);
    });

    /**
     * Границы периода живут на сервере. Строки, для которой периода в
     * ответе нет, мы не знаем ни состояния, ни границ — и сравнивать её
     * не с чем: догадка тут хуже молчания.
     */
    it('начисление без своего периода в сравнение не идёт', () => {
      const rows = periodHistory(accruals, []);
      expect(rows.every((r) => r.viewsDelta === null)).toBeTrue();
      expect(earnedTotal(rows).periods).toBe(3);
    });
  });

  describe('площадки в профиле', () => {
    it('называются только площадки проекта без ссылки', () => {
      const missing = missingAccountLinks(['tiktok', 'youtube', 'vk'], {
        tiktok: 'https://tiktok.com/@me',
      });
      expect(missing).toEqual(['youtube', 'vk']);
    });

    it('пробелы ссылкой не считаются', () => {
      expect(missingAccountLinks(['tiktok'], { tiktok: '   ' })).toEqual(['tiktok']);
    });

    /**
     * Поля под Likee в редакторе профиля нет вовсе. Звать заполнить то,
     * что нечем заполнить, — худший вид совета: человек уходит в профиль
     * и не находит там ничего.
     */
    it('Likee не требуем: заполнить её в профиле негде', () => {
      expect(PROFILE_PLATFORMS).not.toContain('likee');
      expect(missingAccountLinks(ALL_PLATFORMS, {})).not.toContain('likee');
    });

    it('профиля нет — претензий нет', () => {
      expect(missingAccountLinks([], null)).toEqual([]);
    });
  });

  describe('что делать дальше', () => {
    const none = { hasPending: false, missingAccounts: 0 };

    it('сдача ссылок важнее всего остального', () => {
      expect(nextStepKind({ hasPending: true, missingAccounts: 2 })).toBe('submit');
    });

    it('сдавать нечего — зовём заполнить площадки в профиле', () => {
      expect(nextStepKind({ ...none, missingAccounts: 2 })).toBe('profile');
    });

    /**
     * Добор до ступени сюда БОЛЬШЕ НЕ ПОПАДАЕТ, и это не забывчивость.
     *
     * Он звучал на экране дважды: карточка «Заработок за период» пишет
     * «≈ +3 564 ₽ · осталось 100 тыс. просмотров» и держит кнопку
     * «Добавить ролик», а блок «что делать дальше» повторял те же два
     * числа другими словами и ставил вторую такую же кнопку. Осталось
     * одно место — карточка: там рядом стоят числа, ради которых ролик
     * и снимают. Проверяем самое состояние дефекта: до ступени далеко,
     * прогноз есть, сдавать нечего — и второй строки об этом нет.
     */
    it('добор до ступени больше не ближайшее действие: он живёт в карточке заработка', () => {
      expect(nextStepKind(none)).toBeNull();
    });

    /**
     * И он больше не заслоняет пустую площадку в профиле. Раньше ступень
     * стояла в очереди выше, и совет про профиль не показывался никому,
     * у кого до ступени оставалось хоть сколько-то просмотров, — то есть
     * почти всегда.
     */
    it('пустая площадка в профиле больше не заслонена ступенью', () => {
      expect(nextStepKind({ hasPending: false, missingAccounts: 1 })).toBe('profile');
    });
  });
});
