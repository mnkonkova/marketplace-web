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
      loaded ? (of({ terms: loaded }) as never) : (throwError(() => ({ status: 404 })) as never),
    );
    api.managerSaveTerms.and.callFake(
      (_id: string, input: BillingTermsInput) => of(terms(input as never)) as never,
    );
    // Прайс площадки уже на модели «фикс за ролик»: нулевой ступени в
    // нём нет, её место занял fee_per_video.
    api.managerAdoptTerms.and.returnValue(
      of(
        terms({
          fee_per_video: 100_000,
          creator_fee_per_video: 50_000,
          steps: [{ from_views: 300_000, client_fee: 45_000_000 }],
        }),
      ) as never,
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
   * Фикс считается ЗА РОЛИК и приходит своей парой полей, одной на обе
   * модели. Раньше он прятался в нулевой ступени лесенки — то есть одно
   * и то же число жило в двух местах.
   */
  it('фикс за ролик приходит своим полем, ступени — строками таблицы', () => {
    const { cmp } = setup(
      terms({
        fee_per_video: 100_000,
        creator_fee_per_video: 50_000,
        steps: [{ from_views: 300_000, client_fee: 45_000_000, creator_fee: 28_000_000 }],
      }),
    );
    expect(cmp.mode()).toBe('steps');
    expect(cmp.fixClient).toBe(1_000);
    expect(cmp.fixCreator).toBe(500);
    expect(cmp.rows()).toEqual([{ fromViews: 300_000, clientFee: 450_000, creatorFee: 280_000 }]);
  });

  it('проект без ступеней открывается на ставке за тысячу', () => {
    const { cmp } = setup(
      terms({
        fee_per_video: 100_000,
        rate_per_1000_views: 9_000,
        creator_rate_per_1000_views: 7_000,
      }),
    );
    expect(cmp.mode()).toBe('rate');
    expect(cmp.fixClient).toBe(1_000);
    expect(cmp.rateClient).toBe(90);
    expect(cmp.rateCreator).toBe(70);
  });

  it('фикс уходит своим полем, нулевой ступени в лесенке нет', () => {
    const { cmp, api } = setup();
    cmp.setMode('steps');
    cmp.fixClient = 1_000;
    cmp.fixCreator = 500;
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 1_000_000);
    cmp.setCell(0, 'clientFee', 700_000);
    cmp.save();
    const input = api.managerSaveTerms.calls.mostRecent().args[1];
    expect(input.fee_per_video).toBe(100_000);
    expect(input.creator_fee_per_video).toBe(50_000);
    // Нулевой ступени быть не должно: её место занял фикс за ролик, и
    // отправить обе значило бы взять цену дважды.
    expect(input.steps).toEqual([
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

  it('ставка за тысячу: лесенка не отправляется, фикс — за ролик', () => {
    const { cmp, api } = setup();
    cmp.setMode('rate');
    cmp.fixClient = 1_000;
    cmp.fixCreator = 500;
    cmp.rateClient = 90;
    cmp.rateCreator = 70;
    cmp.save();
    const input = api.managerSaveTerms.calls.mostRecent().args[1];
    expect(input.steps).toEqual([]);
    expect(input.fee_per_video).toBe(100_000);
    expect(input.creator_fee_per_video).toBe(50_000);
    // Оклад за период выключен: оставить в снимке прежнее число значило
    // бы посчитать фикс дважды.
    expect(input.salary_per_month).toBe(0);
    expect(input.creator_salary_per_month).toBeNull();
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
    cmp.fixClient = 1_000;
    cmp.addRow();
    cmp.setCell(0, 'fromViews', 500_000);
    cmp.setCell(0, 'clientFee', 400_000);
    cmp.save();
    const input = api.managerSaveTerms.calls.mostRecent().args[1];
    // И в фиксе за ролик, и в ступени — одно правило: пусто значит
    // «столько же, сколько заказчику».
    expect(input.creator_fee_per_video).toBeNull();
    expect(input.steps!.length).toBe(1);
    expect(input.steps![0].creator_fee).toBeNull();
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
    // Фикс за ролик пришёл своим полем, ступени — строками таблицы.
    expect(cmp.fixClient).toBe(1_000);
    expect(cmp.fixCreator).toBe(500);
    expect(cmp.rows()).toEqual([{ fromViews: 300_000, clientFee: 450_000, creatorFee: null }]);
    // Кнопка называется «заполнить», а не «привязать»: сохраняет человек.
    expect(api.managerSaveTerms).not.toHaveBeenCalled();
  });
});
