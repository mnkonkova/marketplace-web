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

  function setup(draftRequired = false, existing: ScheduledPublication[] = []) {
    TestBed.resetTestingModule();
    api = jasmine.createSpyObj<PublicationApi>('api', ['managerCreateBatch']);
    api.managerCreateBatch.and.returnValue(of({ batch_id: 'b1', created: 0, items: [] }) as never);
    ref = jasmine.createSpyObj<NzModalRef>('ref', ['destroy']);
    const data: SchedulePublicationsData = {
      projectID: 'pr1',
      creators: [
        { user_id: 'u1', display_name: 'Анастасия' },
        { user_id: 'u2', display_name: 'Андрей' },
      ],
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
      expect(cmp.isLocked(jan(10))).withContext('стоит у обоих').toBeTrue();
      expect(cmp.isLocked(jan(17))).withContext('стоит у одного — всё равно не снять').toBeTrue();
      expect(cmp.isLocked(jan(20))).withContext('свободная дата').toBeFalse();
      // Неполная дата отмечена отдельно: кому-то её ещё добавят.
      expect(cmp.isPartial(jan(10))).toBeFalse();
      expect(cmp.isPartial(jan(17))).toBeTrue();

      cmp.toggleDay(jan(10));
      expect(cmp.days().has(jan(10))).withContext('галочка осталась').toBeTrue();
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
});
