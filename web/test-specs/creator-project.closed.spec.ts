import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of } from 'rxjs';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { BillingApi } from '@entities/billing/api/billing.api';
import type {
  Accrual,
  AccrualStatus,
  CreatorEarnings,
  CreatorPeriod,
} from '@entities/billing/model/billing.types';
import { MeRepository } from '@entities/me/repository/me.repository';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { CreatorProjectPage } from '@pages/me/creator-project/creator-project.page';

/**
 * Итог за прошлый период — плашкой над вкладками.
 *
 * Подытог ставит воркер через две недели после конца периода, и это
 * единственный момент, когда на вопрос «сколько я заработал» есть
 * окончательный ответ. До него числа едут, после — заморожены. Ответ
 * обязан быть виден сразу, а не строкой истории под всеми блоками.
 *
 * Здесь проверяется, КОГДА плашка есть и что в ней стоит. Правило
 * держится не на календаре, а на деньгах: плашка живёт, пока начисление
 * не выплачено, и уходит, когда выплачено, — тогда период переезжает в
 * «период за периодом», где лежит всё закрытое. Сдвинь условие на даты —
 * и человек, которому не заплатили, перестанет видеть свой итог ровно в
 * тот день, когда начался следующий период.
 */
describe('CreatorProjectPage: итог за прошлый период', () => {
  function period(
    seq: number,
    starts: string,
    ends: string,
    status: 'open' | 'locked',
  ): CreatorPeriod {
    return {
      seq,
      starts_on: `${starts}T00:00:00Z`,
      ends_on: `${ends}T00:00:00Z`,
      status,
      carry_in_creator: 0,
      carry_out_creator: 0,
    };
  }

  function accrual(
    periodStart: string,
    status: AccrualStatus,
    over: Partial<Accrual> = {},
  ): Accrual {
    return {
      id: periodStart,
      project_id: 'pr1',
      creator_user_id: 'c1',
      period_start: `${periodStart}T00:00:00Z`,
      status,
      salary: 6_000_000,
      views_base: 1_000_000,
      views_over: 0,
      views_total: 1_000_000,
      views_bonus: 99_000_000,
      clicks: 0,
      click_bonus: 0,
      videos_planned: 12,
      videos_delivered: 12,
      deduction: 0,
      total: 105_000_000,
      ...over,
    };
  }

  function setup(earnings: CreatorEarnings | null) {
    TestBed.resetTestingModule();
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
        {
          provide: PublicationApi,
          useValue: {
            creatorProjectCard: () => of({ id: 'pr1', title: 'PetFlat', platforms: ['tiktok'] }),
            creatorList: () => of({ items: [] }),
            creatorChecklist: () => of({ items: [] }),
            creatorMaterials: () => of({ items: [] }),
            // Находки «это ваш ролик?» тянутся вместе со страницей.
            creatorSuggestions: () => of({ items: [] }),
            // «Мои аккаунты» — аккаунты проекта, тянутся вместе со страницей.
            creatorAccounts: () => of({ items: [], secrets_enabled: true }),
            creatorReport: () => of({ collapsed: false }),
            creatorRefreshStats: () => of({ saved: 0 }),
          },
        },
        {
          provide: BillingApi,
          useValue: { creatorEarnings: () => (earnings ? of(earnings) : of()) },
        },
        { provide: MeRepository, useValue: { getProfile: () => of(null) } },
        { provide: AuthSessionStore, useValue: { userId: () => 'c1' } },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
      ],
    });
    TestBed.overrideComponent(CreatorProjectPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorProjectPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /** Денег не приходило вовсе — плашке взяться неоткуда. */
  it('без ответа о заработке плашки нет', () => {
    expect(setup(null).lastClosed()).toBeNull();
  });

  /**
   * Идущий период — не итог. Числа по нему ещё меняются каждый день, и
   * назвать их «заработано» значит пообещать сумму, которая к выплате
   * станет другой.
   */
  it('открытый период в плашку не попадает, даже когда начисление по нему уже посчитано', () => {
    const open = period(2, '2026-09-02', '2026-10-01', 'open');
    const page = setup({
      period: open,
      periods: [open],
      accruals: [accrual('2026-09-02', 'draft')],
    });
    expect(page.lastClosed()).toBeNull();
  });

  /**
   * Подытоженный период с невыплаченным начислением — тот самый случай,
   * ради которого плашка заведена.
   */
  it('подытоженный период показывает окончательную сумму', () => {
    const closed = period(1, '2026-08-02', '2026-09-01', 'locked');
    const open = period(2, '2026-09-02', '2026-10-01', 'open');
    const page = setup({
      period: open,
      periods: [closed, open],
      accruals: [accrual('2026-08-02', 'draft')],
    });
    const got = page.lastClosed();
    expect(got).not.toBeNull();
    expect(got?.period.seq).toBe(1);
    expect(got?.row.total).toBe(105_000_000);
    expect(got?.row.salary).toBe(6_000_000);
    expect(got?.row.views_bonus).toBe(99_000_000);
    expect(page.closedTitle()).toContain('Период 1');
    expect(page.closedTitle()).toContain('2 августа');
  });

  /**
   * Выплачено — плашка уходит.
   *
   * Это и есть граница её жизни. Деньги пришли на счёт, вопрос «сколько
   * я заработал» закрыт, и висящая дальше плашка читалась бы как «ещё
   * должны».
   */
  it('выплаченное начисление плашку снимает', () => {
    const closed = period(1, '2026-08-02', '2026-09-01', 'locked');
    const open = period(2, '2026-09-02', '2026-10-01', 'open');
    const page = setup({
      period: open,
      periods: [closed, open],
      accruals: [accrual('2026-08-02', 'paid')],
    });
    expect(page.lastClosed()).toBeNull();
  });

  /**
   * Период подытожен, а начисления по нему нет вовсе — показывать
   * нечего. Пустая плашка со словом «заработано» без суммы хуже её
   * отсутствия: она обещает ответ, которого нет.
   */
  it('подытоженный период без начисления плашку не рисует', () => {
    const closed = period(1, '2026-08-02', '2026-09-01', 'locked');
    const page = setup({ period: closed, periods: [closed], accruals: [] });
    expect(page.lastClosed()).toBeNull();
  });

  /**
   * Невыплаченных подытогов накопилось несколько — человеку нужен
   * свежий. Остальные никуда не деваются: они видны в истории.
   */
  it('из нескольких неоплаченных подытогов берётся последний', () => {
    const first = period(1, '2026-07-03', '2026-08-01', 'locked');
    const second = period(2, '2026-08-02', '2026-09-01', 'locked');
    const open = period(3, '2026-09-02', '2026-10-01', 'open');
    const page = setup({
      period: open,
      periods: [first, second, open],
      accruals: [
        accrual('2026-07-03', 'approved', { total: 40_000_000 }),
        accrual('2026-08-02', 'draft', { total: 105_000_000 }),
      ],
    });
    expect(page.lastClosed()?.period.seq).toBe(2);
    expect(page.lastClosed()?.row.total).toBe(105_000_000);
  });

  /**
   * Состояние денег названо словами, и слова разные.
   *
   * «Подытожено» человек читает как «придут сегодня». Пока менеджер не
   * утвердил, это неправда, и молчать об этом нельзя.
   */
  it('утверждённое и ещё не утверждённое начисление говорят разное', () => {
    const closed = period(1, '2026-08-02', '2026-09-01', 'locked');
    const draft = setup({
      period: closed,
      periods: [closed],
      accruals: [accrual('2026-08-02', 'draft')],
    });
    const approved = setup({
      period: closed,
      periods: [closed],
      accruals: [accrual('2026-08-02', 'approved')],
    });
    expect(draft.closedState()).toContain('ждёт утверждения');
    expect(approved.closedState()).toContain('очереди на выплату');
    expect(draft.closedState()).not.toBe(approved.closedState());
  });

  /**
   * Приблизительность не скрывается. Поденной статистики за период уже
   * нет, числа подтянуты — и человек, который пойдёт их сверять, должен
   * знать это до того, как начнёт.
   */
  it('приблизительный срез отмечается', () => {
    const closed = { ...period(1, '2026-08-02', '2026-09-01', 'locked'), snapshot_approx: true };
    const page = setup({
      period: closed,
      periods: [closed],
      accruals: [accrual('2026-08-02', 'draft')],
    });
    expect(page.closedApprox()).toBeTrue();
  });
});
