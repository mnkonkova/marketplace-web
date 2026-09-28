import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { Payment, PaymentStatus } from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { Publication, PublicationStatus } from '@entities/publication/model/publication.types';
import { ProjectApi } from '@entities/project/api/project.api';
import type { ProjectFullView, ProjectKind } from '@entities/project/model/project.types';
import { ManagerTurnkeyProjectComponent } from '@widgets/manager-turnkey-project/manager-turnkey-project.component';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzDrawerService } from 'ng-zorro-antd/drawer';
import { NzMessageService } from 'ng-zorro-antd/message';
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

  /** Спай сообщений последнего setup: по нему видно отказы формы. */
  let msg: jasmine.SpyObj<NzMessageService>;

  /** Спай записи условий последнего setup: по нему видно, что ушло. */
  let saveTerms: jasmine.Spy;

  function setup(
    items: Publication[],
    payments: Payment[] = [],
    kind: ProjectKind = 'creators_turnkey',
    // Деньги отдельным аргументом: у проекта без креаторов стоимость
    // приходит отчётом, а денежная ручка может ответить отказом — и
    // проверять это надо именно в паре.
    money: { report?: unknown; billingFails?: boolean } = {},
  ) {
    TestBed.resetTestingModule();
    msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error', 'info', 'warning']);
    const api = jasmine.createSpyObj<PublicationApi>('api', [
      'managerList',
      'managerCreators',
      'managerReport',
      'managerProjectSettings',
      // Заявка заказчика на следующий месяц: карточка читает её при
      // загрузке — из неё собирается плашка в «Где сейчас горит».
      'managerMonthRequest',
    ]);
    api.managerList.and.returnValue(of({ items }) as never);
    api.managerCreators.and.returnValue(
      of({
        items: [{ user_id: 'u1', display_name: 'Анастасия', added_at: '2026-09-01' }],
      }) as never,
    );

    // Цифры проекта и список периодов карточка тянет при загрузке:
    // без заглушек эффект падает на первом же рендере.
    api.managerReport.and.returnValue(of(money.report ?? null) as never);
    // Настройки проекта: в карточке ими управляется тумблер «черновик
    // до выкладки», и читаются они тем же заходом.
    api.managerProjectSettings.and.returnValue(of(null) as never);
    api.managerMonthRequest.and.returnValue(of({ request: null }) as never);

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
      'managerSaveTerms',
    ]);
    // 404 no_periods — обычное состояние проекта, у которого ещё не
    // вышло ни одного ролика: периодов нет, и отсчитывать не от чего.
    billing.managerBilling.and.returnValue(
      money.billingFails
        ? (throwError(() => ({ status: 404, error: { error: 'no_periods' } })) as never)
        : (of({ payments }) as never),
    );
    billing.managerPeriods.and.returnValue(of({ items: [] }) as never);
    billing.managerSaveTerms.and.returnValue(of({ project_cost: 0 }) as never);
    saveTerms = billing.managerSaveTerms;

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
        { provide: NzMessageService, useValue: msg },
      ],
    });
    TestBed.overrideComponent(ManagerTurnkeyProjectComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ManagerTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', {
      id: 'pr1',
      title: 'PetFlat',
      kind,
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

  // ---- проект без креаторов ----
  //
  // Карточка у обоих видов одна: заводить второй почти такой же виджет
  // значило бы держать две копии вёрстки, расходящиеся с первой правки.
  // Разводит их карта блоков, и вот проверка, что разводит.

  it('у проекта без креаторов выключены проверка, чек-лист, состав и начисления', () => {
    const cmp = setup([pub({ id: 'a' })], [], 'brand_turnkey');
    const b = cmp.blocks();

    expect(b.review).toBeFalse();
    expect(b.checklist).toBeFalse();
    expect(b.roster).toBeFalse();
    expect(b.billing).toBeFalse();
    // А это остаётся: план, ссылки, аккаунты, материалы и статистика.
    expect(b.publications).toBeTrue();
    expect(b.accounts).toBeTrue();
    expect(b.materials).toBeTrue();
    expect(b.stats).toBeTrue();
    // И появляется своё: стоимость, которую называет менеджер.
    expect(b.cost).toBeTrue();
  });

  it('нижняя полоса на телефоне считается из карты блоков, а не из литерала', () => {
    const creators = setup([pub({ id: 'a' })])
      .phoneTabs()
      .map((t) => t.key);
    expect(creators).toEqual(['alerts', 'plan', 'links', 'review', 'team', 'pay']);

    const brand = setup([pub({ id: 'a' })], [], 'brand_turnkey').phoneTabs();
    // Вкладки «Проверка» у этого вида быть не должно: она открыла бы
    // пустой экран — секцию прячет тач-слой по data-sec.
    expect(brand.map((t) => t.key)).toEqual(['alerts', 'plan', 'links', 'team', 'pay']);
    // «Команда» без состава читается как потерянный раздел: там аккаунты.
    expect(brand.find((t) => t.key === 'team')?.title).toBe('Аккаунты');
  });

  it('у проекта без креаторов не бывает тревоги про предоплату', () => {
    // Выкладка есть, платежей нет — у проекта с креаторами это тревога.
    expect(
      setup([pub({ id: 'a' })], [])
        .alerts()
        .some((a) => a.key === 'prepay'),
    ).toBeTrue();
    // Здесь начислять некому, и обещать действие, которого на экране
    // нет, тревога не должна.
    expect(
      setup([pub({ id: 'a' })], [], 'brand_turnkey')
        .alerts()
        .some((a) => a.key === 'prepay'),
    ).toBeFalse();
  });

  it('стоимость проекта показывается рублями, а пустая — пустой строкой', () => {
    const cmp = setup([], [], 'brand_turnkey');
    // Условий у проекта ещё нет: поле пустое, а не «0» — ноль читался бы
    // как названная нулевая цена.
    expect(cmp.costRubles()).toBe('');
    expect(cmp.costPer1000()).toBeNull();

    cmp.terms.set({ project_cost: 5_000_000 } as never);
    expect(cmp.costRubles()).toBe('50000');
  });

  /**
   * Стоимость проекта у вида без креаторов и денежная ручка, которой
   * ещё нечего считать.
   *
   * Условия приезжают из GET /billing, а та у проекта, где не вышло ни
   * одного ролика, отвечает 404 no_periods — и вместе с несуществующим
   * периодом теряет условия, которые от периода не зависят вовсе. Поле
   * стояло пустым при записанной сумме; человек читал это как «не
   * сохранилось» и жал «Сохранить» поверх пустого — уходил ноль,
   * сумма стиралась, плашка говорила «Стоимость проекта сохранена», а
   * СПВ не появлялся никогда.
   */
  describe('стоимость, когда периодов ещё нет', () => {
    const report = { cost: 18_000_000, views: 2_292_000, cost_per_1000: 7853 };

    it('поле показывает записанную сумму, хотя денежная ручка отказала', () => {
      const cmp = setup([], [], 'brand_turnkey', { billingFails: true, report });

      expect(cmp.terms()).withContext('условий нет — ручка ответила отказом').toBeNull();
      // Но сумма есть: её отдаёт отчёт, он же считает по ней СПВ.
      expect(cmp.costRubles()).toBe('180000');
      expect(cmp.costPer1000()).toBe(7853);
    });

    it('«Сохранить» поверх пустого поля не стирает записанную сумму', () => {
      const cmp = setup([], [], 'brand_turnkey', { billingFails: true, report });
      cmp.costDraft = '';

      cmp.saveCost();

      expect(saveTerms).toHaveBeenCalled();
      const body = saveTerms.calls.mostRecent().args[1] as { project_cost: number };
      expect(body.project_cost).withContext('ноль стёр бы стоимость и унёс СПВ').toBe(18_000_000);
    });

    it('пустое поле у проекта без записанной суммы — отказ, а не ноль', () => {
      const cmp = setup([], [], 'brand_turnkey', { billingFails: true });
      cmp.costDraft = '';

      cmp.saveCost();

      expect(saveTerms).not.toHaveBeenCalled();
      expect(msg.error).toHaveBeenCalled();
    });

    it('введённое число уходит как есть', () => {
      const cmp = setup([], [], 'brand_turnkey', { billingFails: true, report });
      cmp.costDraft = '250000';

      cmp.saveCost();

      const body = saveTerms.calls.mostRecent().args[1] as { project_cost: number };
      expect(body.project_cost).toBe(25_000_000);
    });
  });
});
