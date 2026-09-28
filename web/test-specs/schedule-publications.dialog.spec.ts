import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  ScheduledPublication,
  SchedulePublicationsDialogComponent,
  SchedulePublicationsData,
} from '@features/schedule-publications/schedule-publications.dialog';

/**
 * Массовая простановка дат: календарь и заготовки.
 *
 * Даты уходят на сервер списком, а не схемой с диапазоном, — поэтому
 * ошибка в разборе дня недели видна только по тому, какие клетки
 * подсветились. Заготовка «Вт и Чт», проставившая понедельник и среду,
 * молча создаёт месяц выкладок не в те дни.
 */
describe('SchedulePublicationsDialogComponent', () => {
  let api: jasmine.SpyObj<PublicationApi>;
  let ref: jasmine.SpyObj<NzModalRef>;

  // Месяц в будущем: прошедшие клетки календарь выключает, и заготовка
  // их не трогает — тест не должен зависеть от сегодняшнего числа.
  const FUTURE = new Date(new Date().getFullYear() + 1, 0, 1);

  function setup(draftRequired = false, existing: ScheduledPublication[] = [], crew = true) {
    TestBed.resetTestingModule();
    api = jasmine.createSpyObj<PublicationApi>('api', [
      'managerCreateBatch',
      'managerProjectSettings',
      'managerSaveProjectSettings',
    ]);
    api.managerCreateBatch.and.returnValue(of({ batch_id: 'b1', created: 0, items: [] }) as never);
    // Тумблер этапа черновика правит НАСТРОЙКУ ПРОЕКТА, поэтому окно
    // читает её при открытии: без заглушки падает всё окно, а не одна
    // специя про черновик.
    api.managerProjectSettings.and.returnValue(
      of({ draft_required: draftRequired, client_sees_stats: true }) as never,
    );
    api.managerSaveProjectSettings.and.returnValue(
      of({ draft_required: draftRequired, client_sees_stats: true }) as never,
    );
    ref = jasmine.createSpyObj<NzModalRef>('ref', ['destroy']);
    const data: SchedulePublicationsData = {
      projectID: 'pr1',
      creators: [
        { user_id: 'u1', display_name: 'Анастасия' },
        { user_id: 'u2', display_name: 'Андрей' },
      ],
      crew,
      draftRequired,
      existing,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PublicationApi, useValue: api },
        { provide: NzModalRef, useValue: ref },
        { provide: NZ_MODAL_DATA, useValue: data },
        {
          provide: NzMessageService,
          useValue: jasmine.createSpyObj('msg', ['error', 'success', 'info']),
        },
      ],
    });
    TestBed.overrideComponent(SchedulePublicationsDialogComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(SchedulePublicationsDialogComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    // Показываем заведомо будущий январь: прошедшие клетки календарь
    // выключает, и тест не должен зависеть от сегодняшнего числа.
    cmp.showMonth(FUTURE.getFullYear(), 0);
    return cmp;
  }

  /** Дата в заведомо будущем январе. */
  function jan(day: number): string {
    return `${FUTURE.getFullYear()}-01-${String(day).padStart(2, '0')}`;
  }

  /** День недели выбранной даты, посчитанный в локальном времени. */
  function weekdayOf(date: string): number {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  }

  it('«Вт и Чт» отмечает вторники и четверги, а не соседние дни', () => {
    const cmp = setup();
    cmp.preset('tue_thu');
    const picked = [...cmp.days()];

    expect(picked.length).withContext('в месяце восемь-девять таких дней').toBeGreaterThan(6);
    for (const d of picked) {
      expect([2, 4]).withContext(`${d} — не вторник и не четверг`).toContain(weekdayOf(d));
    }
  });

  it('«Пн, Ср, Пт» — только эти три дня', () => {
    const cmp = setup();
    cmp.preset('mon_wed_fri');
    for (const d of cmp.days()) {
      expect([1, 3, 5]).withContext(d).toContain(weekdayOf(d));
    }
  });

  it('«Сбросить» чистит только показанный месяц', () => {
    const cmp = setup();
    cmp.preset('tue_thu');
    const january = [...cmp.days()];
    cmp.shiftMonth(1);
    cmp.preset('tue_thu');
    const both = cmp.days().size;
    expect(both).toBeGreaterThan(january.length);

    // Сброс в феврале январь не трогает: месяц набирают по одному.
    cmp.preset('clear');
    expect([...cmp.days()].sort()).toEqual(january.sort());
  });

  it('в запрос уходят выбранные даты, а не схема с диапазоном', () => {
    const cmp = setup();
    cmp.togglePicked('u1');
    cmp.preset('tue_thu');
    const expected = [...cmp.days()].sort();

    cmp.create();

    const [projectId, req] = api.managerCreateBatch.calls.mostRecent().args;
    expect(projectId).toBe('pr1');
    expect(req.creator_user_ids).toEqual(['u1']);
    expect(req.dates).toEqual(expected);
    expect(req.scheme).withContext('схема больше не используется').toBeUndefined();
  });

  /**
   * Главное, ради чего окно перестало открываться пустым.
   *
   * Пустой календарь поверх непустого плана человек читает как «плана
   * нет» и набирает даты заново — а на сервере они складываются с уже
   * стоящими. Получается не исправленный план, а старый плюс новый.
   */
  describe('открывается на текущем плане', () => {
    const existing: ScheduledPublication[] = [
      { creator_user_id: 'u1', due_date: `${jan(10)}T00:00:00Z`, status: 'planned' },
      { creator_user_id: 'u2', due_date: jan(10), status: 'planned' },
      { creator_user_id: 'u1', due_date: jan(17), status: 'planned' },
      // Отменённая не считается: её дата снова свободна.
      { creator_user_id: 'u2', due_date: jan(24), status: 'cancelled' },
    ];

    it('стоящие даты и их креаторы отмечены сразу', () => {
      const cmp = setup(false, existing);
      expect([...cmp.days()].sort()).toEqual([jan(10), jan(17)]);
      expect([...cmp.picked()].sort()).toEqual(['u1', 'u2']);
    });

    it('считает то, что добавится, а не «люди × дни»', () => {
      const cmp = setup(false, existing);
      // Двое × две даты = четыре пары, из них три уже стоят: 10-е у
      // обоих и 17-е у одного. Заведётся ровно одна — 17-е второму.
      expect(cmp.total()).toBe(4);
      expect(cmp.toCreate()).toBe(1);
      expect(cmp.alreadySet()).toBe(3);
    });

    it('стоящую дату отсюда не снять — и окно об этом говорит', () => {
      const cmp = setup(false, existing);
      // Хватает одной существующей выкладки: снятая галочка всё равно
      // ничего не отменит, а человек уйдёт уверенный, что дату убрал.
      expect(cmp.isLocked(jan(10)))
        .withContext('стоит у обоих')
        .toBeTrue();
      expect(cmp.isLocked(jan(17)))
        .withContext('стоит у одного — всё равно не снять')
        .toBeTrue();
      expect(cmp.isLocked(jan(20)))
        .withContext('свободная дата')
        .toBeFalse();
      // Неполная дата отмечена отдельно: кому-то её ещё добавят.
      expect(cmp.isPartial(jan(10))).toBeFalse();
      expect(cmp.isPartial(jan(17))).toBeTrue();

      cmp.toggleDay(jan(10));
      expect(cmp.days().has(jan(10)))
        .withContext('галочка осталась')
        .toBeTrue();
    });

    it('«Сбросить» не снимает того, что уже в плане', () => {
      const cmp = setup(false, existing);
      cmp.toggleDay(jan(20));
      cmp.preset('clear');
      expect([...cmp.days()].sort()).toEqual([jan(10), jan(17)]);
    });

    it('когда добавлять нечего, запрос не уходит', () => {
      const cmp = setup(false, [
        { creator_user_id: 'u1', due_date: jan(10), status: 'planned' },
        { creator_user_id: 'u2', due_date: jan(10), status: 'planned' },
      ]);
      expect(cmp.toCreate()).toBe(0);
      cmp.create();
      expect(api.managerCreateBatch).not.toHaveBeenCalled();
    });

    it('в запрос уходит весь план, а не только новые даты', () => {
      const cmp = setup(false, existing);
      cmp.toggleDay(jan(20));
      cmp.create();
      const req = api.managerCreateBatch.calls.mostRecent().args[1];
      // Уже стоящие пары сервер пропускает сам (ON CONFLICT по паре
      // «креатор и день»), поэтому список дат — это тот же план, что
      // человек видит на экране.
      expect(req.dates).toEqual([jan(10), jan(17), jan(20)]);
    });
  });

  it('без креаторов или без дней запрос не уходит', () => {
    const cmp = setup();
    cmp.preset('tue_thu');
    cmp.create();
    expect(api.managerCreateBatch).not.toHaveBeenCalled();

    const other = setup();
    other.togglePicked('u1');
    other.create();
    expect(api.managerCreateBatch).not.toHaveBeenCalled();
  });

  it('срок черновика уходит, только когда этап включён', () => {
    const cmp = setup(true);
    cmp.togglePicked('u1');
    cmp.preset('tue_thu');
    cmp.draftLeadDays = 3;

    cmp.create();
    expect(api.managerCreateBatch.calls.mostRecent().args[1].draft_lead_days).toBe(3);

    cmp.draftOn.set(false);
    cmp.create();
    expect(api.managerCreateBatch.calls.mostRecent().args[1].draft_lead_days).toBe(0);
  });

  // Тумблер этапа черновика живёт ТОЛЬКО здесь: с карточки менеджера он
  // убран, потому что решение принимают в тот момент, когда ставят даты.
  // Значит окно обязано и прочитать настройку проекта, и записать её.
  describe('этап черновика — настройка проекта', () => {
    it('открывается на записанном в проекте значении, а не на подсказке', () => {
      // data.draftRequired приходит false, настройки проекта говорят true.
      TestBed.resetTestingModule();
      api = jasmine.createSpyObj<PublicationApi>('api', [
        'managerCreateBatch',
        'managerProjectSettings',
        'managerSaveProjectSettings',
      ]);
      api.managerCreateBatch.and.returnValue(
        of({ batch_id: 'b1', created: 0, items: [] }) as never,
      );
      api.managerProjectSettings.and.returnValue(
        of({ draft_required: true, client_sees_stats: false }) as never,
      );
      api.managerSaveProjectSettings.and.returnValue(
        of({ draft_required: true, client_sees_stats: false }) as never,
      );
      TestBed.configureTestingModule({
        providers: [
          { provide: PublicationApi, useValue: api },
          { provide: NzModalRef, useValue: jasmine.createSpyObj<NzModalRef>('ref', ['destroy']) },
          {
            provide: NZ_MODAL_DATA,
            useValue: {
              projectID: 'pr1',
              creators: [{ user_id: 'u1', display_name: 'Анастасия' }],
              crew: true,
              draftRequired: false,
              existing: [],
            } as SchedulePublicationsData,
          },
          {
            provide: NzMessageService,
            useValue: jasmine.createSpyObj('msg', ['error', 'success', 'info']),
          },
        ],
      });
      TestBed.overrideComponent(SchedulePublicationsDialogComponent, { set: { template: '' } });
      const fixture = TestBed.createComponent(SchedulePublicationsDialogComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.draftOn()).toBeTrue();
    });

    it('переключённый тумблер сохраняется целиком, вместе с чужими полями', () => {
      const cmp = setup(false);
      cmp.toggleDraft();
      cmp.togglePicked('u1');
      cmp.preset('tue_thu');

      cmp.create();

      expect(api.managerSaveProjectSettings).toHaveBeenCalledWith('pr1', {
        // client_sees_stats обязан доехать нетронутым: ручка заменяет
        // настройки целиком, и отправка одного поля погасила бы
        // заказчику статистику.
        client_sees_stats: true,
        draft_required: true,
      });
    });

    it('нетронутый тумблер настройку не переписывает', () => {
      const cmp = setup(false);
      cmp.togglePicked('u1');
      cmp.preset('tue_thu');

      cmp.create();

      expect(api.managerSaveProjectSettings).not.toHaveBeenCalled();
    });
  });

  /**
   * Проект без креаторов: даты ставятся, людей не спрашивают.
   *
   * Это была не косметика, а тупик. Счётчик считал «люди × дни», при
   * нуле людей давал ноль, кнопка оставалась выключенной, а если до
   * отправки всё же доходило — окно отвечало «Выберите хотя бы одного
   * креатора». Единственный способ проставить такому проекту даты был
   * закрыт, хотя сервер такие пачки принимает с самого начала.
   */
  describe('проект без креаторов', () => {
    it('считает даты, а не «люди × дни»', () => {
      const cmp = setup(false, [], false);
      cmp.toggleDay(jan(3));
      cmp.toggleDay(jan(5));

      expect(cmp.toCreate()).toBe(2);
    });

    it('шлёт пустой список людей, а не выдуманного человека', () => {
      const cmp = setup(false, [], false);
      cmp.toggleDay(jan(3));

      cmp.create();

      expect(api.managerCreateBatch).toHaveBeenCalledWith('pr1', {
        // Пустой список — это и есть признак, по которому сервер
        // отличает пачку на проект от пачки людям. Внутренний ключ
        // ряда (пустая строка) туда уехать не должен.
        creator_user_ids: [],
        dates: [jan(3)],
        draft_lead_days: 0,
      });
    });

    it('не требует выбрать креатора', () => {
      const cmp = setup(false, [], false);
      cmp.toggleDay(jan(3));

      cmp.create();

      expect(api.managerCreateBatch).toHaveBeenCalled();
    });

    it('стоящие даты узнаёт по выкладкам без владельца', () => {
      // У таких выкладок бэк не отдаёт creator_user_id вовсе, и ключом
      // в карте плана идёт пустая строка. Иначе окно открылось бы с
      // «0 уже в плане» и предложило завести дату второй раз.
      const cmp = setup(false, [{ due_date: jan(3), status: 'planned' } as never], false);

      expect(cmp.isLocked(jan(3))).toBeTrue();
      expect(cmp.toCreate()).toBe(0);
    });
  });
});
