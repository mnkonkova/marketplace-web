import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of, throwError } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { BillingTerms, BillingTermsInput } from '@entities/billing/model/billing.types';
import { ProjectTariffComponent } from '@widgets/project-tariff/project-tariff.component';

/**
 * Тариф проекта — своя таблица, а не копия общего прайса.
 *
 * Правило, которое легко потерять: деньги в таблице вводят В РУБЛЯХ, а
 * на сервер уходят КОПЕЙКИ. Перепутать эти единицы — значит ошибиться в
 * сто раз в ту сторону, где ошибку заметят по счёту, а не по экрану.
 */
describe('ProjectTariffComponent', () => {
  function terms(over: Partial<BillingTerms> = {}): BillingTerms {
    return {
      project_id: 'pr1',
      salary_per_month: 0,
      rate_per_1000_views: 0,
      rate_per_1000_views_over: 0,
      bonus_views_threshold: 0,
      ...over,
    } as BillingTerms;
  }

  function setup(loaded: BillingTerms | null = terms()) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<BillingApi>('billingApi', [
      'managerBilling',
      'managerSaveTerms',
      'managerAdoptTerms',
    ]);
    api.managerBilling.and.returnValue(
      loaded
        ? (of({ terms: loaded }) as never)
        : (throwError(() => ({ status: 404 })) as never),
    );
    api.managerSaveTerms.and.callFake(
      (_id: string, input: BillingTermsInput) => of(terms(input as never)) as never,
    );
    api.managerAdoptTerms.and.returnValue(
      of(terms({ steps: [{ from_views: 0, client_fee: 30_000_000 }] })) as never,
    );
    const msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BillingApi, useValue: api },
        { provide: NzMessageService, useValue: msg },
      ],
    });
    TestBed.overrideComponent(ProjectTariffComponent, { set: { template: '' } });
    const f = TestBed.createComponent(ProjectTariffComponent);
    f.componentRef.setInput('projectId', 'pr1');
    f.detectChanges();
    return { cmp: f.componentInstance, api, msg };
  }

  /**
   * Фикс — это ступень с нулевым порогом, но в форме он отдельным
   * полем: человек знает его до всякого KPI и вписывает первым, а в
   * таблице ищет пороги.
   */
  it('нулевая ступень с сервера становится фиксом, остальные — строками', () => {
    const { cmp } = setup(
      terms({
        steps: [
          { from_views: 0, client_fee: 30_000_000, creator_fee: 18_000_000 },
          { from_views: 300_000, client_fee: 45_000_000, creator_fee: 28_000_000 },
        ],
      }),
    );
    expect(cmp.mode()).toBe('steps');
    expect(cmp.fixClient).toBe(300_000);
    expect(cmp.fixCreator).toBe(180_000);
    expect(cmp.rows()).toEqual([{ fromViews: 300_000, clientFee: 450_000, creatorFee: 280_000 }]);
  });

  it('проект без ступеней открывается на ставке за тысячу', () => {
    const { cmp } = setup(
      terms({
        salary_per_month: 6_000_000,
        rate_per_1000_views: 9_000,
        creator_rate_per_1000_views: 7_000,
      }),
    );
    expect(cmp.mode()).toBe('rate');
    expect(cmp.fixClient).toBe(60_000);
    expect(cmp.rateClient).toBe(90);
    expect(cmp.rateCreator).toBe(70);
  });

  it('ступени: фикс уходит нулевой ступенью, рубли — копейками', () => {
    const { cmp, api } = setup();
    cmp.setMode('steps');
    cmp.fixClient = 300_000;
    cmp.fixCreator = 180_000;
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 1_000_000);
    cmp.setCell(0, 'clientFee', 700_000);
    cmp.save();
    const input = api.managerSaveTerms.calls.mostRecent().args[1];
    expect(input.steps).toEqual([
      { from_views: 0, client_fee: 30_000_000, creator_fee: 18_000_000 },
      { from_views: 1_000_000, client_fee: 70_000_000, creator_fee: null },
    ]);
  });

  /**
   * Две модели не смешиваются: непустая лесенка на сервере отменяет
   * ставку за тысячу, и «немножко того, немножко этого» дало бы цену,
   * которую не сойтись руками.
   */
  it('ставка за тысячу со ступенями не отправляется', () => {
    const { cmp, api } = setup();
    cmp.setMode('steps');
    cmp.fixClient = 300_000;
    cmp.rateClient = 90;
    cmp.save();
    const input = api.managerSaveTerms.calls.mostRecent().args[1];
    expect(input.rate_per_1000_views).toBe(0);
    expect(input.salary_per_month).toBe(0);
  });

  it('ставка за тысячу: лесенка не отправляется, фикс идёт окладом', () => {
    const { cmp, api } = setup();
    cmp.setMode('rate');
    cmp.fixClient = 60_000;
    cmp.fixCreator = 45_000;
    cmp.rateClient = 90;
    cmp.rateCreator = 70;
    cmp.save();
    const input = api.managerSaveTerms.calls.mostRecent().args[1];
    expect(input.steps).toEqual([]);
    expect(input.salary_per_month).toBe(6_000_000);
    expect(input.creator_salary_per_month).toBe(4_500_000);
    expect(input.rate_per_1000_views).toBe(9_000);
    expect(input.creator_rate_per_1000_views).toBe(7_000);
  });

  /**
   * Пустая клетка «креатору» значит «столько же, сколько заказчику», а
   * не ноль: до заполнения стороны совпадают и маржи у площадки нет.
   * Ноль здесь означал бы «работает бесплатно».
   */
  it('пустая клетка креатора уходит как null, а не как ноль', () => {
    const { cmp, api } = setup();
    cmp.setMode('steps');
    cmp.fixClient = 300_000;
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 500_000);
    cmp.setCell(0, 'clientFee', 400_000);
    cmp.save();
    const steps = api.managerSaveTerms.calls.mostRecent().args[1].steps!;
    expect(steps[0].creator_fee).toBeNull();
    expect(steps[1].creator_fee).toBeNull();
  });

  it('две ступени с одним порогом не дают сохранить', () => {
    const { cmp, api } = setup();
    cmp.setMode('steps');
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 100_000);
    cmp.setCell(0, 'clientFee', 300_000);
    cmp.addRow();
    cmp.setCell(1, 'fromViews', 100_000);
    cmp.setCell(1, 'clientFee', 400_000);
    expect(cmp.problem()).toContain('одним порогом');
    cmp.save();
    expect(api.managerSaveTerms).not.toHaveBeenCalled();
  });

  /** Нулевой порог в таблице — это второй фикс, и так сказано. */
  it('нулевой порог в таблице не принимается', () => {
    const { cmp } = setup();
    cmp.setMode('steps');
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 0);
    cmp.setCell(0, 'clientFee', 300_000);
    expect(cmp.problem()).toContain('это фикс');
  });

  it('креатору больше, чем заказчику, — не даёт ни в фиксе, ни в ступени', () => {
    const { cmp } = setup();
    cmp.setMode('steps');
    cmp.fixClient = 100_000;
    cmp.fixCreator = 200_000;
    expect(cmp.problem()).toContain('Фикс креатору больше');

    cmp.fixCreator = null;
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 500_000);
    cmp.setCell(0, 'clientFee', 100_000);
    cmp.setCell(0, 'creatorFee', 200_000);
    expect(cmp.problem()).toContain('больше, чем платит заказчик');
  });

  it('за тысячу креатору больше, чем заказчику, — тоже не даёт', () => {
    const { cmp } = setup();
    cmp.setMode('rate');
    cmp.rateClient = 90;
    cmp.rateCreator = 120;
    expect(cmp.problem()).toContain('За тысячу креатору');
  });

  /**
   * Показ сортируется, а сама таблица — нет: строку добавляют в конец,
   * и перестроение списка под курсором увело бы поле ввода из-под рук.
   */
  it('ступени показываются по возрастанию порога, не трогая порядок строк', () => {
    const { cmp } = setup();
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 500_000);
    cmp.setCell(0, 'clientFee', 700_000);
    cmp.addRow();
    cmp.setCell(1, 'fromViews', 0);
    cmp.setCell(1, 'clientFee', 300_000);
    expect(cmp.sorted().map((x) => x.r.fromViews)).toEqual([0, 500_000]);
    expect(cmp.rows().map((r) => r.fromViews)).toEqual([500_000, 0]);
  });

  /** У проекта без периодов ручка отвечает 404 — это не сбой. */
  it('проект без периодов открывается пустой таблицей', () => {
    const { cmp } = setup(null);
    expect(cmp.loading()).toBeFalse();
    expect(cmp.rows()).toEqual([]);
  });

  it('«заполнить из прайса» только подставляет числа — сохраняет человек', () => {
    const { cmp, api } = setup();
    cmp.fromPrice();
    // Нулевая ступень прайса встала фиксом, а не строкой таблицы.
    expect(cmp.fixClient).toBe(300_000);
    expect(cmp.rows()).toEqual([]);
    expect(api.managerSaveTerms).not.toHaveBeenCalled();
  });
});
