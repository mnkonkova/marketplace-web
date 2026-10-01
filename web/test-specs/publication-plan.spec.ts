import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { of, throwError } from 'rxjs';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ProjectPerson, Publication } from '@entities/publication/model/publication.types';
import { PublicationPlanComponent } from '@widgets/publication-plan/publication-plan.component';

/**
 * План выкладок: сетка «креатор × день», в которой менеджер ставит и
 * двигает даты.
 *
 * До неё правка плана была только массовой — «проставить пачкой», — а
 * живой месяц правится по одной строке: креатор заболел, вместо
 * выбывшего взяли нового, один день сняли совсем. Здесь проверяется
 * ровно то, за что отвечает сетка: какое состояние она рисует в клетке,
 * что предлагает сделать и чего не предлагает никогда.
 *
 * Главное правило: СДАННОЕ ПРАВКА ПЛАНА НЕ ТРОГАЕТ. У выкладки со
 * ссылками ролик уже вышел, и «перенос» переписал бы историю периода
 * задним числом. Держит это правило сервер (409 publication_started),
 * а сетка просто не предлагает того, чего делать нельзя.
 */
describe('PublicationPlanComponent: правка плана по одной клетке', () => {
  /**
   * Месяц сетки — ОТНОСИТЕЛЬНЫЙ, а не прибитый к сентябрю 2026.
   *
   * Прибитый протух молча: первого октября в сентябрьской сетке не
   * осталось ни одного БУДУЩЕГО дня, и проверка «пустая клетка ставит
   * выкладку» упала на поиске такой клетки — не потому, что сломалась
   * постановка, а потому, что кончился месяц. Правило простое: где
   * нужен свободный день впереди — следующий месяц, где нужен
   * прошедший — прошлый.
   */
  function monthShift(by: number): string {
    const d = new Date();
    const m = new Date(d.getFullYear(), d.getMonth() + by, 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
  }

  const MONTH = monthShift(1);

  function person(over: Partial<ProjectPerson> = {}): ProjectPerson {
    return {
      user_id: over.user_id ?? 'c1',
      display_name: over.display_name ?? 'Аня Ким',
      added_at: '2026-09-01T00:00:00Z',
      ...over,
    } as ProjectPerson;
  }

  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: over.id ?? 'p1',
      project_id: 'pr1',
      creator_user_id: over.creator_user_id ?? 'c1',
      due_date: over.due_date ?? `${MONTH}-10`,
      status: over.status ?? 'planned',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      links: over.links ?? [],
      overdue: over.overdue ?? false,
      views: 0,
      likes: 0,
      comments: 0,
      ...over,
    } as Publication;
  }

  function setup(
    pubs: Publication[] = [],
    people: ProjectPerson[] = [person()],
    period?: { start: string; end: string },
  ) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerAddPublication',
      'managerMoveDueDate',
      'managerCancelPublication',
      'managerRemind',
      'managerSetCreatorReminder',
    ]);
    api.managerAddPublication.and.returnValue(of(pub()) as never);
    api.managerMoveDueDate.and.returnValue(of(pub()) as never);
    api.managerCancelPublication.and.returnValue(of(pub()) as never);
    api.managerRemind.and.returnValue(of({ sent: true }) as never);
    api.managerSetCreatorReminder.and.returnValue(of({ day_before: true }) as never);

    const msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error', 'info']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: msg },
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['confirm', 'create']) },
      ],
    });
    TestBed.overrideComponent(PublicationPlanComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(PublicationPlanComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.componentRef.setInput('creators', people);
    fixture.componentRef.setInput('publications', pubs);
    if (period) {
      fixture.componentRef.setInput('periodStart', period.start);
      fixture.componentRef.setInput('periodEnd', period.end);
    }
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.month.set(MONTH);
    return { cmp, api, msg, fixture };
  }

  function cellOn(cmp: PublicationPlanComponent, day: string) {
    return cmp.rows()[0].cells.find((c) => c.date === `${MONTH}-${day}`)!;
  }

  /**
   * Клетка рисует СОСТОЯНИЕ, а не факт наличия строки: вышел, просрочен,
   * сдан и ждёт проверки, просто в плане. Четыре разных дела менеджера,
   * и путать их нельзя.
   */
  it('состояние клетки читается по выкладке, а не по её наличию', () => {
    const { cmp } = setup([
      pub({ id: 'a', due_date: `${MONTH}-02`, status: 'done' }),
      pub({ id: 'b', due_date: `${MONTH}-03`, overdue: true }),
      pub({
        id: 'c',
        due_date: `${MONTH}-04`,
        status: 'partial',
        links: [{ platform: 'tiktok' }] as never,
        review: { status: 'in_review', round: 1, marks: [] },
      }),
      pub({ id: 'd', due_date: `${MONTH}-05` }),
    ]);
    expect(cellOn(cmp, '02').state).toBe('d');
    expect(cellOn(cmp, '03').state).toBe('l');
    expect(cellOn(cmp, '04').state).toBe('r');
    expect(cellOn(cmp, '05').state).toBe('p');
    expect(cellOn(cmp, '06').state).toBe('');
  });

  /** Отменённая выкладка освобождает день: её сняли с плана. */
  it('отменённая выкладка не занимает клетку', () => {
    const { cmp } = setup([pub({ due_date: `${MONTH}-07`, status: 'cancelled' })]);
    expect(cellOn(cmp, '07').state).toBe('');
    expect(cellOn(cmp, '07').pub).toBeUndefined();
  });

  it('пустая клетка ставит выкладку этому креатору на этот день', () => {
    const { cmp, api } = setup();
    // Месяц сетки — сентябрь 2026, и день выбираем заведомо будущий:
    // на прошедший сервер всё равно ответит отказом.
    const future = cmp.rows()[0].cells.find((c) => !c.pub && c.date >= cmp.today)!;
    expect(future).withContext('в следующем месяце есть свободный день').toBeDefined();
    cmp.pick(person(), future);
    cmp.add();
    expect(api.managerAddPublication).toHaveBeenCalledWith('pr1', 'c1', future.date);
  });

  /**
   * Клетка в прошлом: дату подставляем сегодняшнюю, а не ту, по которой
   * нажали. Отправить прошедший день — гарантированный отказ сервера, и
   * разбираться, почему «поставить» не работает, человек будет сам.
   */
  it('по клетке в прошлом день подставляется сегодняшний', () => {
    const { cmp } = setup();
    // Прошлый месяц: в нём любая клетка заведомо позади, какое бы
    // сегодня ни было число.
    cmp.month.set(monthShift(-1));
    const past = cmp.rows()[0].cells[0];
    expect(past.date < cmp.today).toBeTrue();
    cmp.pick(person(), past);
    expect(cmp.addOn).toBe(cmp.today);
  });

  it('перенос уходит на сервер новой датой', () => {
    const { cmp, api } = setup([pub({ id: 'p9', due_date: `${MONTH}-10` })]);
    cmp.pick(person(), cellOn(cmp, '10'));
    cmp.moveTo = `${MONTH}-14`;
    cmp.move();
    expect(api.managerMoveDueDate).toHaveBeenCalledWith('p9', `${MONTH}-14`);
  });

  /** Перенос на ту же дату — не перенос: молча ничего не делать хуже всего. */
  it('перенос на ту же дату не отправляется, а объясняется', () => {
    const { cmp, api, msg } = setup([pub({ id: 'p9', due_date: `${MONTH}-10` })]);
    cmp.pick(person(), cellOn(cmp, '10'));
    cmp.moveTo = `${MONTH}-10`;
    cmp.move();
    expect(api.managerMoveDueDate).not.toHaveBeenCalled();
    expect(msg.error).toHaveBeenCalled();
  });

  /**
   * Отказ сервера показываем ЕГО словами: он знает и про занятый день, и
   * про подытоженный период. Свой пересказ разошёлся бы с правилами на
   * первой же их правке.
   */
  it('отказ сервера показывается его текстом', () => {
    const { cmp, api, msg } = setup();
    api.managerAddPublication.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { code: 'day_taken', message: 'На эту дату у креатора уже есть выкладка.' },
      })) as never,
    );
    cmp.pick(person(), cellOn(cmp, '12'));
    cmp.add();
    expect(msg.error).toHaveBeenCalledWith('На эту дату у креатора уже есть выкладка.');
  });

  /** Пинг идёт по ближайшей НЕСДАННОЙ выкладке, а не по первой попавшейся. */
  it('напоминание уходит по ближайшей несданной выкладке', () => {
    const { cmp, api } = setup([
      pub({ id: 'done', due_date: `${MONTH}-02`, status: 'done' }),
      pub({ id: 'next', due_date: `${MONTH}-20` }),
      pub({ id: 'later', due_date: `${MONTH}-25` }),
    ]);
    cmp.remind(cmp.rows()[0]);
    expect(api.managerRemind).toHaveBeenCalledWith('next');
  });

  it('несданных нет — говорим об этом, а не шлём пустоту', () => {
    const { cmp, api, msg } = setup([pub({ id: 'done', due_date: `${MONTH}-02`, status: 'done' })]);
    cmp.remind(cmp.rows()[0]);
    expect(api.managerRemind).not.toHaveBeenCalled();
    expect(msg.info).toHaveBeenCalled();
  });

  /**
   * Счётчики строки считаются по тем же выкладкам, что рисует сетка:
   * иначе строка обещала бы одно, а клетки показывали другое.
   */
  it('счётчики строки сходятся с клетками', () => {
    const { cmp } = setup([
      pub({ id: 'a', due_date: `${MONTH}-02`, status: 'done' }),
      pub({ id: 'b', due_date: `${MONTH}-03`, overdue: true }),
      pub({ id: 'c', due_date: `${MONTH}-30`, status: 'cancelled' }),
    ]);
    const row = cmp.rows()[0];
    expect(row.planned).toBe(2);
    expect(row.done).toBe(1);
    expect(row.late).toBe(1);
  });

  /**
   * Чем кончается период, видно только здесь.
   *
   * Месяц считает календарь, а последнюю выкладку ставит человек — и
   * она может стоять раньше расчётной границы. Подтверждает конец
   * периода менеджер в «Где горит», но СМОТРИТ он на план.
   */
  describe('метка последней выкладки периода', () => {
    const period = { start: `${MONTH}-01`, end: `${MONTH}-30` };

    it('последняя выкладка в границах периода помечена', () => {
      const { cmp } = setup(
        [pub({ id: 'a', due_date: `${MONTH}-10` }), pub({ id: 'b', due_date: `${MONTH}-24` })],
        [person()],
        period,
      );
      expect(cmp.lastOfPeriod()).toBe(`${MONTH}-24`);
      expect(cellOn(cmp, '24').lastOfPeriod).toBeTrue();
      expect(cellOn(cmp, '10').lastOfPeriod).toBeFalse();
    });

    /** Последний день периода — это колонка, а не выкладка. */
    it('расчётная граница помечает свой столбец', () => {
      const { cmp } = setup([pub({ due_date: `${MONTH}-24` })], [person()], period);
      expect(cellOn(cmp, '30').periodEnd).toBeTrue();
      expect(cellOn(cmp, '24').periodEnd).toBeFalse();
    });

    /** Выкладка следующего периода последней в этом не становится. */
    it('выкладки за границей периода не считаются', () => {
      const { cmp } = setup([pub({ id: 'a', due_date: `${MONTH}-24` })], [person()], {
        start: `${MONTH}-01`,
        end: `${MONTH}-20`,
      });
      expect(cmp.lastOfPeriod()).toBe('');
    });

    /** Снятая выкладка периода не кончает: её в плане больше нет. */
    it('отменённые выкладки не считаются', () => {
      const { cmp } = setup(
        [
          pub({ id: 'a', due_date: `${MONTH}-10` }),
          pub({ id: 'b', due_date: `${MONTH}-24`, status: 'cancelled' }),
        ],
        [person()],
        period,
      );
      expect(cmp.lastOfPeriod()).toBe(`${MONTH}-10`);
    });

    it('без периода метки нет вовсе', () => {
      const { cmp } = setup([pub({ due_date: `${MONTH}-24` })]);
      expect(cmp.lastOfPeriod()).toBe('');
      expect(cellOn(cmp, '24').lastOfPeriod).toBeFalse();
    });
  });
});

/**
 * Колокольчик в строке креатора — НЕ пинг.
 *
 * Пинг — разовое «напомни сейчас». Колокольчик говорит, писать ли этому
 * человеку КАЖДЫЙ раз накануне срока: «завтра срок» — ещё рабочее
 * напоминание, а «сегодня срок» — уже констатация. Путать их нельзя:
 * менеджер, щёлкнувший колокольчик, ждёт тишины сегодня и письма
 * завтра, а не письма прямо сейчас.
 */
describe('PublicationPlanComponent: колокольчик «напомнить накануне»', () => {
  const MONTH = '2026-09';

  function person(over: Partial<ProjectPerson> = {}): ProjectPerson {
    return {
      user_id: over.user_id ?? 'c1',
      display_name: over.display_name ?? 'Аня Ким',
      added_at: '2026-09-01T00:00:00Z',
      ...over,
    } as ProjectPerson;
  }

  function setup(people: ProjectPerson[]) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerAddPublication',
      'managerMoveDueDate',
      'managerCancelPublication',
      'managerRemind',
      'managerSetCreatorReminder',
    ]);
    api.managerSetCreatorReminder.and.returnValue(of({ day_before: true }) as never);
    api.managerRemind.and.returnValue(of({ sent: true }) as never);
    const msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error', 'info']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: msg },
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['confirm', 'create']) },
      ],
    });
    TestBed.overrideComponent(PublicationPlanComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(PublicationPlanComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.componentRef.setInput('creators', people);
    fixture.componentRef.setInput('publications', []);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.month.set(MONTH);
    return { cmp, api, msg };
  }

  it('состояние приходит с сервера, а не считается заново', () => {
    const { cmp } = setup([
      person({ user_id: 'c1', remind_day_before: true }),
      person({ user_id: 'c2', display_name: 'Лев', remind_day_before: false }),
    ]);
    expect(cmp.bellOn(cmp.rows()[0])).toBeTrue();
    expect(cmp.bellOn(cmp.rows()[1])).toBeFalse();
  });

  it('нажатие переключает ровно этого человека', () => {
    const { cmp, api } = setup([
      person({ user_id: 'c1', remind_day_before: false }),
      person({ user_id: 'c2', display_name: 'Лев', remind_day_before: false }),
    ]);
    cmp.toggleBell(cmp.rows()[0]);
    expect(api.managerSetCreatorReminder).toHaveBeenCalledWith('pr1', 'c1', true);
    expect(cmp.bellOn(cmp.rows()[0])).toBeTrue();
    expect(cmp.bellOn(cmp.rows()[1])).toBeFalse();
  });

  /**
   * Колокольчик, показывающий не то, что на сервере, хуже колокольчика,
   * который не нажался: менеджер уйдёт со страницы уверенным, что
   * человеку напомнят.
   */
  it('отказ сервера возвращает колокольчик как было', () => {
    const { cmp, api, msg } = setup([person({ user_id: 'c1', remind_day_before: false })]);
    api.managerSetCreatorReminder.and.returnValue(throwError(() => ({ status: 500 })) as never);
    cmp.toggleBell(cmp.rows()[0]);
    expect(cmp.bellOn(cmp.rows()[0])).toBeFalse();
    expect(msg.error).toHaveBeenCalled();
  });

  it('пинг остаётся отдельным действием и колокольчик не трогает', () => {
    const { cmp, api } = setup([person({ user_id: 'c1', remind_day_before: false })]);
    cmp.remind(cmp.rows()[0]);
    expect(api.managerSetCreatorReminder).not.toHaveBeenCalled();
  });

  /**
   * Медиана, а не среднее: один залетевший ролик поднимает среднее
   * вдвое и обещает то, чего обычно не бывает. И вместе с числом — на
   * скольких роликах оно посчитано: «по 3» и «по 12» — разной силы
   * утверждения.
   */
  it('подпись креатора — медиана с числом роликов', () => {
    const { cmp } = setup([person({ median: { views: 190_000, basis: 12 } })]);
    expect(cmp.medianLabel(cmp.rows()[0])).toBe('медиана 190 тыс. по 12 роликам');
  });

  it('без медианы подписи нет вовсе', () => {
    const { cmp } = setup([person()]);
    expect(cmp.medianLabel(cmp.rows()[0])).toBe('');
  });
});
