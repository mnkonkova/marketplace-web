import { TestBed } from '@angular/core/testing';

import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import type { Publication } from '@entities/publication/model/publication.types';
import { CreatorLadderComponent } from '@widgets/creator-ladder/creator-ladder.component';

/**
 * Шкала креатора: что складывается в деньги и что считается «впереди».
 *
 * Арифметику подписей проверяет ladder.spec — здесь то, что живёт в
 * компоненте: правый конец полосы, остаток до ступени и сколько роликов
 * периода ещё не вышло. От последнего зависит, скажет ли экран «сними
 * ещё» там, где снимать негде.
 */
describe('CreatorLadderComponent', () => {
  const PERIOD = {
    seq: 1,
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

  function setup(e: CreatorEarnings | null, pubs: Publication[] = []) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(CreatorLadderComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorLadderComponent);
    fixture.componentRef.setInput('earnings', e);
    fixture.componentRef.setInput('publications', pubs);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  describe('сколько роликов периода ещё впереди', () => {
    /**
     * Ровно та ошибка, из-за которой экран поздравлял раньше времени:
     * выкладка, сданная на одну площадку из пяти, считалась закрытой, и
     * при единственном таком ролике экран объявлял «план периода
     * выполнен» — при том что ролик ещё не вышел.
     */
    it('наполовину сданный ролик ещё впереди: он не вышел', () => {
      const cmp = setup(earnings(), [
        pub({ id: 'a', links: [{ id: 'l1', platform: 'tiktok', url: 'u' }] as never }),
      ]);
      expect(cmp.plannedLeft()).toBe(1);
      expect(cmp.planDone()).toBeFalse();
    });

    it('вышедший ролик впереди не считается', () => {
      const cmp = setup(earnings(), [pub({ id: 'a', published_at: '2026-09-05T00:00:00Z' })]);
      expect(cmp.plannedLeft()).toBe(0);
      expect(cmp.planDone()).toBeTrue();
    });

    it('отменённая выкладка ничего не ждёт', () => {
      expect(setup(earnings(), [pub({ status: 'cancelled' })]).plannedLeft()).toBe(0);
    });

    it('выкладка соседнего периода в счёт не идёт', () => {
      const cmp = setup(earnings(), [pub({ due_date: '2026-10-05T00:00:00Z' })]);
      expect(cmp.plannedLeft()).toBe(0);
    });

    /**
     * План ставит менеджер. Ролик, который креатор добавил себе сам,
     * планом не становится — иначе собственная добавка гасила бы «план
     * периода выполнен»: человек добрал сверх плана и тут же прочитал,
     * что план не выполнен. Это же правило держит и оклад: знаменатель
     * недосдачи считается только по плановым выкладкам.
     */
    it('свой добавленный ролик планом не становится', () => {
      const cmp = setup(earnings(), [pub({ id: 'own', self_added: true })]);
      expect(cmp.plannedLeft()).toBe(0);
      expect(cmp.planDone()).toBeTrue();
      expect(cmp.ownAhead()).toBe(1);
    });

    it('плановые и свои считаются порознь', () => {
      const cmp = setup(earnings(), [
        pub({ id: 'plan' }),
        pub({ id: 'own', due_date: '2026-09-20T00:00:00Z', self_added: true }),
      ]);
      expect(cmp.plannedLeft()).toBe(1);
      expect(cmp.ownAhead()).toBe(1);
      expect(cmp.planDone()).toBeFalse();
    });
  });

  describe('деньги', () => {
    const accrual = {
      id: 'a1',
      project_id: 'pr1',
      creator_user_id: 'c1',
      period_start: '2026-09-01T00:00:00Z',
      status: 'draft' as const,
      salary: 6_000_000,
      views_base: 0,
      views_over: 0,
      views_total: 0,
      views_bonus: 500_000,
      clicks: 0,
      click_bonus: 0,
      videos_planned: 2,
      videos_delivered: 1,
      deduction: 0,
      total: 6_500_000,
    };

    const forecast = {
      step_views: 100_000,
      views_to_go: 40_000,
      carry_in_included: 0,
      forecast_payout: 356_400,
    };

    it('правый конец полосы — заработанное плюс прогноз ступени', () => {
      const cmp = setup(earnings({ accruals: [accrual], next_step_forecast: forecast }));
      expect(cmp.earned()?.total).toBe(6_500_000);
      expect(cmp.atStep()).toBe(6_500_000 + 356_400);
    });

    /**
     * Начисления по периоду может не быть вовсе: пока его не
     * пересчитывали, строки в базе нет. Складывать не с чем — и
     * выдуманной суммы на полосе появиться не должно.
     */
    it('без начисления суммы на ступени нет, а прогноз остаётся', () => {
      const cmp = setup(earnings({ next_step_forecast: forecast }));
      expect(cmp.earned()).toBeNull();
      expect(cmp.atStep()).toBeNull();
      expect(cmp.forecast()?.forecast_payout).toBe(356_400);
    });

    it('без прогноза правого конца тоже нет: выдумывать его нечем', () => {
      expect(setup(earnings({ accruals: [accrual] })).atStep()).toBeNull();
    });

    // Остаток до ступени сервер считает вместе с перенесённым, а мы про
    // перенос знаем только то, что он уже в счёте. Своя арифметика —
    // запасной вариант, а не второе мнение.
    it('остаток до ступени берётся из прогноза, когда он есть', () => {
      expect(setup(earnings({ next_step_forecast: forecast })).toNext()).toBe(40_000);
      expect(setup(earnings({ next_step_forecast: forecast })).progressPercent()).toBe(60);
    });

    it('прогноза нет — считаем по измеренным просмотрам сами', () => {
      const cmp = setup(earnings(), [
        pub({ id: 'a', published_at: '2026-09-05T00:00:00Z', views: 30_000 }),
      ]);
      expect(cmp.toNext()).toBe(70_000);
    });
  });

  it('периода нет — шкале не от чего отсчитывать', () => {
    const cmp = setup({ periods: [] });
    expect(cmp.period()).toBeNull();
    expect(cmp.plannedLeft()).toBe(0);
    // Роликов периода без периода не бывает: границ, по которым их
    // отбирают, просто нет.
    expect(cmp.periodVideos().length).toBe(0);
  });
});
