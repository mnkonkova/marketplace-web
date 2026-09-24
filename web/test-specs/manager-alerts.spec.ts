import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { EMPTY, of } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { Payment, ProjectPeriod } from '@entities/billing/model/billing.types';
import { ProjectApi } from '@entities/project/api/project.api';
import type { ProjectFullView } from '@entities/project/model/project.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { Publication } from '@entities/publication/model/publication.types';
import { ManagerTurnkeyProjectComponent } from '@widgets/manager-turnkey-project/manager-turnkey-project.component';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzDrawerService } from 'ng-zorro-antd/drawer';

/**
 * «Где сейчас горит» — первое, что читают на экране менеджера.
 *
 * Правило, которое легко потерять: в карточке стоит ЧИСЛО, и это число
 * настоящее. Сумма показывается только там, где её считает сервер
 * (начислено минус полученное); в остальных карточках — количество
 * выкладок. Оценок вида «под угрозой ≈ столько-то» здесь быть не должно:
 * такую величину нам никто не считает, а придуманная цифра в тревоге
 * хуже её отсутствия — по ней принимают решения.
 */
describe('ManagerTurnkeyProjectComponent: тревоги', () => {
  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: over.id ?? 'p1',
      project_id: 'pr1',
      creator_user_id: 'u1',
      due_date: '2026-09-11',
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

  function setup(
    opts: {
      pubs?: Publication[];
      payments?: Payment[];
      accrued?: number;
      views?: number;
      deductions?: number;
      period?: Partial<ProjectPeriod> | null;
    } = {},
  ) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerList',
      'managerCreators',
      'managerRemind',
    ]);
    api.managerList.and.returnValue(of({ items: opts.pubs ?? [] }) as never);
    api.managerCreators.and.returnValue(of({ items: [] }) as never);
    api.managerRemind.and.returnValue(of({ sent: true }) as never);

    // Платежи и итоги приходят одной ручкой — так же, как в проде.
    const billing = jasmine.createSpyObj<BillingApi>('billingApi', [
      'managerBilling',
      'managerConfirmPeriodEnd',
    ]);
    billing.managerBilling.and.returnValue(
      of({
        totals: {
          total: opts.accrued ?? 0,
          views: opts.views ?? 0,
          deductions: opts.deductions ?? 0,
        },
        payments: opts.payments ?? [],
        period: opts.period ?? undefined,
      } as never) as never,
    );
    billing.managerConfirmPeriodEnd.and.returnValue(of({ period: {} } as never) as never);

    const projects = jasmine.createSpyObj<ProjectApi>('projectApi', [
      'managerAssigned',
      'managerListEvents',
    ]);
    projects.managerAssigned.and.returnValue(EMPTY);
    // Журнал под начислениями: событий в этих тестах нет, но ручка
    // дёргается при загрузке проекта.
    projects.managerListEvents.and.returnValue(EMPTY);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: BillingApi, useValue: billing },
        { provide: ProjectApi, useValue: projects },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('router', ['navigate']) },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
        // Окна кабинета открываются через общий помощник: на десктопе
        // окном, на телефоне шторкой. Компоненту нужны оба сервиса,
        // даже если в этом тесте их не зовут.
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['create', 'confirm']) },
        { provide: NzDrawerService, useValue: jasmine.createSpyObj('drawer', ['create']) },
      ],
    });
    TestBed.overrideComponent(ManagerTurnkeyProjectComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ManagerTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', {
      id: 'pr1',
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC',
    } as ProjectFullView);
    fixture.detectChanges();
    return { cmp: fixture.componentInstance, api, billing };
  }

  it('спокойный день — тревог нет вовсе', () => {
    expect(setup().cmp.alerts().length).toBe(0);
  });

  it('просроченные выкладки дают карточку с их количеством', () => {
    const { cmp } = setup({ pubs: [pub({ id: 'a', overdue: true }), pub({ id: 'b' })] });
    const a = cmp.alerts().find((x) => x.key === 'overdue')!;
    expect(a).toBeTruthy();
    expect(a.value).toBe('1');
    expect(a.tone).toBe('crit');
  });

  /**
   * Сумма в карточке предоплаты — разница между начисленным и
   * полученным, обе величины считает сервер. Ничего «примерного».
   */
  it('предоплата: сумма — это нехватка к начисленному', () => {
    const { cmp } = setup({ pubs: [pub()], accrued: 12_000_000, payments: [] });
    const a = cmp.alerts().find((x) => x.key === 'prepay')!;
    expect(a).toBeTruthy();
    expect(a.value).toBe(cmp.money(12_000_000));
  });

  it('подтверждённая предоплата тревогу снимает', () => {
    const { cmp } = setup({
      pubs: [pub()],
      accrued: 12_000_000,
      payments: [
        {
          id: 'pay1',
          project_id: 'pr1',
          kind: 'prepayment',
          amount: 12_000_000,
          status: 'confirmed',
          created_at: '2026-09-01T00:00:00Z',
        },
      ],
    });
    expect(cmp.alerts().some((x) => x.key === 'prepay')).toBeFalse();
  });

  /**
   * Конец периода подтверждает человек.
   *
   * Границу считает автомат — месяц от первой выкладки, — и он остаётся
   * главным путём. Но последняя выкладка периода может стоять не в тот
   * день, в который месяц кончается по арифметике, и знает об этом
   * только тот, кто ставил план.
   */
  describe('подтверждение конца периода', () => {
    const period = (over: Partial<ProjectPeriod> = {}): Partial<ProjectPeriod> => ({
      id: 'per1',
      seq: 2,
      starts_on: '2026-09-01',
      ends_on: '2026-09-30',
      status: 'open',
      ...over,
    });

    it('период с планом и без подтверждения — спрашиваем', () => {
      const { cmp } = setup({ pubs: [pub({ due_date: '2026-09-28' })], period: period() });
      const a = cmp.alerts().find((x) => x.key === 'period-end')!;
      expect(a).toBeTruthy();
      // В карточке стоит расчётная граница, а в тексте — день последней
      // выкладки: именно его чаще всего и подтверждают.
      expect(a.value).toBe('30.09');
      expect(a.text).toContain('28.09');
    });

    it('подтверждённый период больше не спрашиваем', () => {
      const { cmp } = setup({
        pubs: [pub({ due_date: '2026-09-28' })],
        period: period({ ends_on_confirmed_at: '2026-09-20T10:00:00Z' }),
      });
      expect(cmp.alerts().some((x) => x.key === 'period-end')).toBeFalse();
    });

    /** Подытоженный период не трогают: под ним уже стоит счёт. */
    it('подытоженный период не спрашиваем', () => {
      const { cmp } = setup({
        pubs: [pub({ due_date: '2026-09-28' })],
        period: period({ status: 'locked' }),
      });
      expect(cmp.alerts().some((x) => x.key === 'period-end')).toBeFalse();
    });

    it('период без единой выкладки подтверждать нечем', () => {
      const { cmp } = setup({ pubs: [], period: period() });
      expect(cmp.alerts().some((x) => x.key === 'period-end')).toBeFalse();
    });

    /** Выкладка следующего периода границу этого не двигает. */
    it('выкладки вне границ периода не считаются', () => {
      const { cmp } = setup({ pubs: [pub({ due_date: '2026-10-05' })], period: period() });
      expect(cmp.alerts().some((x) => x.key === 'period-end')).toBeFalse();
    });

    it('«Подтвердить» уходит без даты — это отметка «проверил»', () => {
      const { cmp, billing } = setup({
        pubs: [pub({ due_date: '2026-09-28' })],
        period: period(),
      });
      cmp.onAlertAction('period-end');
      expect(billing.managerConfirmPeriodEnd).toHaveBeenCalledWith('pr1', 2, undefined);
    });

    it('«Другая дата» подставляет день последней выкладки', () => {
      const { cmp } = setup({ pubs: [pub({ due_date: '2026-09-28' })], period: period() });
      cmp.onAlertAction('period-date');
      expect(cmp.periodDateOpen()).toBeTrue();
      expect(cmp.periodDateDraft).toBe('2026-09-28');
    });

    it('выбранная дата уходит на сервер', () => {
      const { cmp, billing } = setup({
        pubs: [pub({ due_date: '2026-09-28' })],
        period: period(),
      });
      cmp.confirmPeriodEnd('2026-09-28');
      expect(billing.managerConfirmPeriodEnd).toHaveBeenCalledWith('pr1', 2, '2026-09-28');
    });
  });

  it('частично собранные ссылки — отдельная карточка', () => {
    const { cmp } = setup({ pubs: [pub({ status: 'partial' })] });
    expect(cmp.alerts().some((x) => x.key === 'partial')).toBeTrue();
  });

  it('«Напомнить всем» пингует каждую горящую выкладку по одному разу', () => {
    const { cmp, api } = setup({
      pubs: [pub({ id: 'a', overdue: true }), pub({ id: 'b', overdue: true }), pub({ id: 'c' })],
    });
    cmp.remindBurning();
    expect(
      api.managerRemind.calls
        .allArgs()
        .map((x) => x[0])
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('повторное нажатие во время отправки ничего не дублирует', () => {
    const { cmp, api } = setup({ pubs: [pub({ id: 'a', overdue: true })] });
    cmp.reminding.set(true);
    cmp.remindBurning();
    expect(api.managerRemind).not.toHaveBeenCalled();
  });

  /**
   * Число просмотров у менеджера и заказчика обязано совпадать, а
   * совпадает оно, только если взято из одного места — из итогов
   * периода, которые считает сервер.
   */
  it('просмотры ленты берутся из итогов периода', () => {
    const { cmp } = setup({ pubs: [pub()], views: 1_520_900 });
    expect(cmp.projectViews()).toBe(1_520_900);
  });

  it('ноль просмотров — это ноль, а не пустота', () => {
    const { cmp } = setup({ pubs: [pub()], views: 0 });
    expect(cmp.projectViews()).toBe(0);
    expect(cmp.totals()).toBeTruthy();
  });

  /**
   * Сданная ссылка без свежего сбора — это НЕ ноль просмотров, а
   * отсутствие измерения. Разницу видно только из этой карточки.
   */
  it('ссылки без сбора двое суток дают карточку «Счётчики молчат»', () => {
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const { cmp } = setup({
      pubs: [
        pub({
          status: 'done',
          links: [
            {
              id: 'l1',
              publication_id: 'p1',
              platform: 'tiktok',
              url: 'https://tiktok.com/x',
              url_canonical: 'https://tiktok.com/x',
              submitted_at: old,
              last_collected_at: old,
            },
          ],
        }),
      ],
    });
    expect(cmp.staleLinks().count).toBe(1);
    expect(cmp.alerts().some((a) => a.key === 'stale')).toBeTrue();
  });

  it('свежий сбор тревоги не поднимает', () => {
    const fresh = new Date().toISOString();
    const { cmp } = setup({
      pubs: [
        pub({
          status: 'done',
          links: [
            {
              id: 'l1',
              publication_id: 'p1',
              platform: 'tiktok',
              url: 'https://tiktok.com/x',
              url_canonical: 'https://tiktok.com/x',
              submitted_at: fresh,
              last_collected_at: fresh,
            },
          ],
        }),
      ],
    });
    expect(cmp.staleLinks().count).toBe(0);
  });

  /**
   * В карточке просрочек стоит сумма вычетов — её считает сервер.
   * Оценки «под угрозой ≈ столько-то просмотров» здесь нет и быть не
   * должно: такой величины никто не считает.
   */
  it('просрочки показывают вычеты, когда они есть', () => {
    const { cmp } = setup({ pubs: [pub({ overdue: true })], deductions: 1_500_000 });
    const a = cmp.alerts().find((x) => x.key === 'overdue')!;
    expect(a.value).toBe('−' + cmp.money(1_500_000));
    expect(a.valueNote).toContain('вычеты');
  });
});
