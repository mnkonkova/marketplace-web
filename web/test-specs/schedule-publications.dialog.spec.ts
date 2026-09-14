import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

import { PublicationApi } from '@entities/publication/api/publication.api';
import {
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

  function setup(draftRequired = false) {
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
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PublicationApi, useValue: api },
        { provide: NzModalRef, useValue: ref },
        { provide: NZ_MODAL_DATA, useValue: data },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['error', 'success']) },
      ],
    });
    TestBed.overrideComponent(SchedulePublicationsDialogComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(SchedulePublicationsDialogComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    // Перематываем календарь на заведомо будущий январь.
    const now = new Date();
    const months = (FUTURE.getFullYear() - now.getFullYear()) * 12 - now.getMonth();
    cmp.shiftMonth(months);
    return cmp;
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
