import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { Payment, PaymentStatus } from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { Publication, PublicationStatus } from '@entities/publication/model/publication.types';
import { ProjectApi } from '@entities/project/api/project.api';
import type { ProjectFullView } from '@entities/project/model/project.types';
import { ManagerTurnkeyProjectComponent } from '@widgets/manager-turnkey-project/manager-turnkey-project.component';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzDrawerService } from 'ng-zorro-antd/drawer';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

/**
 * Шапка проекта у менеджера.
 *
 * Считает она то же, что показывает план: отменённые выкладки сняты с
 * плана намеренно, и «Выкладок: 10» над планом, где написано «Закрыто 1 из
 * 1, отменённых скрыто: 9», — не округление, а два разных ответа на один
 * вопрос. Плюс два состояния шапки, которые видно только по данным:
 * пустая сводка дня и предупреждение о предоплате.
 */
describe('ManagerTurnkeyProjectComponent: шапка проекта', () => {
  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: over.id ?? 'p1',
      project_id: 'pr1',
      creator_user_id: 'u1',
      // Дата далеко в будущем: «дедлайн ≤ 2 дней» не должен срабатывать
      // сам по себе и делать сводку дня ненулевой.
      due_date: '2099-01-01',
      status: 'planned' as PublicationStatus,
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

  function payment(status: PaymentStatus): Payment {
    return {
      id: 'pay1',
      project_id: 'pr1',
      kind: 'prepayment',
      amount: 100_000,
      status,
      created_at: '2026-09-01T00:00:00Z',
    };
  }

  function setup(items: Publication[], payments: Payment[] = []) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('api', [
      'managerList',
      'managerCreators',
      'managerReport',
    ]);
    api.managerList.and.returnValue(of({ items }) as never);
    api.managerCreators.and.returnValue(
      of({
        items: [{ user_id: 'u1', display_name: 'Анастасия', added_at: '2026-09-01' }],
      }) as never,
    );

    // Цифры проекта и список периодов карточка тянет при загрузке:
    // без заглушек эффект падает на первом же рендере.
    api.managerReport.and.returnValue(of(null) as never);

    const projects = jasmine.createSpyObj<ProjectApi>('projects', [
      'managerAssigned',
      'managerListEvents',
    ]);
    projects.managerAssigned.and.returnValue(of({ items: [] }) as never);
    // Журнал под начислениями: дёргается при загрузке проекта.
    projects.managerListEvents.and.returnValue(of({ items: [] }) as never);

    const billing = jasmine.createSpyObj<BillingApi>('billing', [
      'managerBilling',
      'managerPeriods',
    ]);
    billing.managerBilling.and.returnValue(of({ payments }) as never);
    billing.managerPeriods.and.returnValue(of({ items: [] }) as never);

    TestBed.configureTestingModule({
      providers: [
        // Окна («добавить креатора», простановка дат) открываются через
        // общий помощник: на десктопе окном, на телефоне шторкой.
        // Компоненту нужны оба сервиса, даже если в тесте их не зовут.
        provideNoopAnimations(),
        // Кнопка «Переоткрыть период» есть только у админа: карточка
        // спрашивает роль у сессии, а та ходит по HTTP.
        provideHttpClient(),
        provideHttpClientTesting(),
        // Карточка читает номер периода из адреса: ссылкой на
        // подытоженный период делятся в переписке. Заглушка, а не
        // настоящий роутер: спека про тревоги и деньги, а не про
        // навигацию, и поднимать ради одного queryParamMap весь
        // маршрутизатор значит тащить в тест то, что он не проверяет.
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: PublicationApi, useValue: api },
        { provide: ProjectApi, useValue: projects },
        { provide: BillingApi, useValue: billing },
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['create', 'confirm']) },
        { provide: NzDrawerService, useValue: jasmine.createSpyObj('drawer', ['create']) },
      ],
    });
    TestBed.overrideComponent(ManagerTurnkeyProjectComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ManagerTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', {
      id: 'pr1',
      title: 'PetFlat',
      kind: 'creators_turnkey',
    } as ProjectFullView);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('счётчик выкладок не считает отменённые', () => {
    const cmp = setup([
      pub({ id: 'a', status: 'done' }),
      ...Array.from({ length: 9 }, (_, i) =>
        pub({ id: `c${i}`, status: 'cancelled' as PublicationStatus }),
      ),
    ]);

    // Ровно то, что показывает план: одна действующая и девять снятых.
    expect(cmp.livePublications().length).toBe(1);
    expect(cmp.cancelledCount()).toBe(9);
  });

  it('отменённые не попадают и в сводку дня', () => {
    const cmp = setup([
      pub({ id: 'a', status: 'cancelled', overdue: true }),
      pub({ id: 'b', status: 'cancelled', overdue: true }),
    ]);

    expect(cmp.today().overdue).toBe(0);
    expect(cmp.todayCalm()).toBe(true);
  });

  it('сводка дня разворачивается, как только появляется ненулевое', () => {
    const cmp = setup([pub({ id: 'a', overdue: true })]);

    expect(cmp.todayCalm()).toBe(false);
    expect(cmp.today().overdue).toBe(1);
  });

  it('выкладки есть, предоплаты нет — предупреждаем', () => {
    const cmp = setup([pub({ id: 'a' })], []);

    expect(cmp.prepaymentRisk()).toBe(true);
    expect(cmp.prepaymentAwaited()).toBe(false);
  });

  it('сумма выставлена, но деньги не отмечены — всё ещё предупреждаем', () => {
    const cmp = setup([pub({ id: 'a' })], [payment('awaiting')]);

    expect(cmp.prepaymentRisk()).toBe(true);
    expect(cmp.prepaymentAwaited()).toBe(true);
  });

  it('после подтверждения предоплаты предупреждение уходит', () => {
    const cmp = setup([pub({ id: 'a' })], [payment('confirmed')]);

    expect(cmp.prepaymentRisk()).toBe(false);
  });

  it('без выкладок не предупреждаем: работа ещё не началась', () => {
    const cmp = setup([], []);

    expect(cmp.prepaymentRisk()).toBe(false);
  });

  it('отменённые выкладки за начало работы не считаются', () => {
    const cmp = setup([pub({ id: 'a', status: 'cancelled' })], []);

    expect(cmp.prepaymentRisk()).toBe(false);
  });
});
