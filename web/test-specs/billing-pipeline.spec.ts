import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { Accrual, ProjectBilling } from '@entities/billing/model/billing.types';
import { ProjectBillingComponent } from '@widgets/project-billing/project-billing.component';

/**
 * Конвейер периода: пересчитали → подытожили → утвердили → выплатили.
 *
 * Порядок жёсткий — бэк не даст выплатить неутверждённое, — и полоса
 * обязана показывать, где период стоит на самом деле. Главная ловушка:
 * ПРЕДВАРИТЕЛЬНАЯ строка (is_preview) в базе не существует, статуса у
 * неё нет, и `status !== 'draft'` для неё истинно. Без оговорки про это
 * непересчитанный период показывал «утверждено» — то есть ровно
 * противоположное правде.
 */
describe('ProjectBillingComponent: конвейер периода', () => {
  function accrual(over: Partial<Accrual> = {}): Accrual {
    return {
      id: over.id ?? 'a1',
      project_id: 'pr1',
      creator_user_id: 'u1',
      creator_name: 'Аня Ким',
      period_start: '2026-09-01',
      salary: 2_500_000,
      videos_planned: 4,
      videos_delivered: 3,
      deduction: 0,
      views_total: 100,
      views_base: 0,
      views_over: 0,
      views_bonus: 0,
      clicks: 0,
      click_bonus: 0,
      total: 2_500_000,
      status: 'draft',
      ...over,
    } as Accrual;
  }

  function setup(billing: Partial<ProjectBilling>) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<BillingApi>('billingApi', [
      'managerBilling',
      'managerPeriods',
    ]);
    api.managerBilling.and.returnValue(of(billing as ProjectBilling));
    api.managerPeriods.and.returnValue(of({ items: [] } as never) as never);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BillingApi, useValue: api },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['confirm', 'create']) },
      ],
    });
    TestBed.overrideComponent(ProjectBillingComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ProjectBillingComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.componentRef.setInput('role', 'manager');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const period = (status: 'open' | 'locked') => ({
    seq: 3,
    starts_on: '2026-09-01',
    ends_on: '2026-09-30',
    status,
    carry_in_client: 0,
    carry_out_client: 0,
    carry_in_creator: 0,
    carry_out_creator: 0,
    id: 'per3',
    project_id: 'pr1',
  });

  function step(cmp: ProjectBillingComponent, key: string) {
    return cmp.pipeline().find((s) => s.key === key)!;
  }

  it('предварительные строки — период ещё не пересчитан и не утверждён', () => {
    const cmp = setup({
      period: period('open') as never,
      accruals: [accrual({ is_preview: true, status: '' as never })],
    });
    expect(step(cmp, 'recalc').done).toBeFalse();
    expect(step(cmp, 'recalc').current).toBeTrue();
    expect(step(cmp, 'approve').done).toBeFalse();
    expect(step(cmp, 'pay').done).toBeFalse();
  });

  it('сохранённые черновики — пересчитано, дальше ждём подытога', () => {
    const cmp = setup({ period: period('open') as never, accruals: [accrual()] });
    expect(step(cmp, 'recalc').done).toBeTrue();
    expect(step(cmp, 'lock').current).toBeTrue();
    expect(step(cmp, 'approve').done).toBeFalse();
  });

  it('период подытожен — следующий шаг «Утвердить»', () => {
    const cmp = setup({ period: period('locked') as never, accruals: [accrual()] });
    expect(step(cmp, 'lock').done).toBeTrue();
    expect(step(cmp, 'approve').current).toBeTrue();
    expect(cmp.canApproveAll()).toBeTrue();
  });

  it('всё утверждено — следующий шаг «Выплатить»', () => {
    const cmp = setup({
      period: period('locked') as never,
      accruals: [accrual({ status: 'approved' })],
    });
    expect(step(cmp, 'approve').done).toBeTrue();
    expect(step(cmp, 'pay').current).toBeTrue();
    expect(cmp.canPayAll()).toBeTrue();
  });

  it('всё выплачено — конвейер пройден целиком', () => {
    const cmp = setup({
      period: period('locked') as never,
      accruals: [accrual({ status: 'paid' })],
    });
    expect(cmp.pipeline().every((s) => s.done)).toBeTrue();
    expect(cmp.canPayAll()).toBeFalse();
  });

  /**
   * Одна неутверждённая строка из трёх — период не утверждён. Иначе
   * «Выплатить всем» предложили бы там, где бэк ответит 409.
   */
  it('утверждено не всё — шаг не закрыт', () => {
    const cmp = setup({
      period: period('locked') as never,
      accruals: [accrual({ id: 'a1', status: 'approved' }), accrual({ id: 'a2', status: 'draft' })],
    });
    expect(step(cmp, 'approve').done).toBeFalse();
  });

  it('журнал собирается из отметок утверждения и выплаты', () => {
    const cmp = setup({
      period: { ...period('locked'), locked_at: '2026-10-14T10:00:00Z' } as never,
      accruals: [
        accrual({
          status: 'paid',
          approved_at: '2026-10-15T09:00:00Z',
          paid_at: '2026-10-16T09:00:00Z',
        }),
      ],
    });
    const texts = cmp.journal().map((j) => j.text);
    expect(texts.some((t) => t.startsWith('Выплачено'))).toBeTrue();
    expect(texts.some((t) => t.startsWith('Утверждено'))).toBeTrue();
    expect(texts.some((t) => t.includes('подытожен'))).toBeTrue();
    // Свежее — сверху: журнал читают с последнего действия.
    expect(texts[0].startsWith('Выплачено')).toBeTrue();
  });
});
