import { TestBed } from '@angular/core/testing';

import {
  monthInWords,
  monthShort,
  monthStrip,
  monthToOpen,
  neighbourMonths,
} from '@entities/publication/lib/calendar-months';
import type { CalendarDay } from '@entities/publication/model/publication.types';
import { ProjectCalendarComponent } from '@widgets/project-calendar/project-calendar.component';

/**
 * Календарь выкладок: почему он «не показывал выкладки».
 *
 * Сетка рисует ОДИН месяц и открывалась всегда на текущем. Выкладки при
 * этом стоят там, где идёт период проекта, а период катится от даты
 * первой публикации и на календарный месяц не ложится. У проекта с
 * одиннадцатью выкладками десять приходилось на август: заказчик
 * открывал сентябрь, видел одну точку в пустой сетке и говорил, что
 * календарь сломан. Он и не показывал — они были рядом, и ничто на это
 * не намекало.
 *
 * Лечится это двумя вещами, и обе проверяются здесь: открывать месяц, в
 * котором что-то есть, и говорить, в каких месяцах оно вообще есть.
 */
describe('календарь: где искать выкладки', () => {
  describe('какой месяц открыть', () => {
    it('в текущем месяце что-то есть — открываем его', () => {
      // Заказчик пришёл смотреть, что происходит сейчас: уводить его в
      // прошлое только потому, что там выкладок больше, нельзя.
      expect(monthToOpen(['2026-07', '2026-08', '2026-09'], '2026-09')).toBe('2026-09');
    });

    it('в текущем пусто — открываем последний месяц с выкладками', () => {
      // Ровно тот случай, с которого всё началось: сентябрь пуст,
      // выкладки в августе.
      expect(monthToOpen(['2026-07', '2026-08'], '2026-09')).toBe('2026-08');
    });

    it('всё впереди — открываем ближайший будущий', () => {
      // Проект только завели: даты проставлены вперёд, и показывать
      // пустой текущий месяц значит показывать пустоту вместо плана.
      expect(monthToOpen(['2026-11', '2026-12'], '2026-09')).toBe('2026-11');
    });

    it('выкладок нет вовсе — остаёмся на текущем', () => {
      // Пустой календарь здесь правильный ответ, а не потеря: прыгать
      // некуда, и прыжок в никуда сбил бы сильнее пустоты.
      expect(monthToOpen([], '2026-09')).toBe('2026-09');
    });

    it('мусор в списке не открывается', () => {
      // Месяц не в формате ГГГГ-ММ мы открыть не умеем, и попытка дала
      // бы пустую сетку — то есть тот самый симптом, который тут лечат.
      expect(monthToOpen(['вчера', '2026-13', '2026-8'], '2026-09')).toBe('2026-09');
    });
  });

  describe('соседние месяцы', () => {
    it('ближайший до и ближайший после — по обе стороны от показанного', () => {
      const n = neighbourMonths(['2026-06', '2026-08', '2026-11', '2026-12'], '2026-09');
      expect(n.before).toBe('2026-08');
      expect(n.after).toBe('2026-11');
    });

    it('у единственного месяца соседей нет', () => {
      // Обещать «посмотрите в соседнем» там, где соседнего нет, — врать.
      const n = neighbourMonths(['2026-09'], '2026-09');
      expect(n.before).toBeNull();
      expect(n.after).toBeNull();
    });
  });

  describe('полоса месяцев', () => {
    it('показанный месяц в полосе есть всегда', () => {
      // Иначе получилась бы полоса, в которой не отмечен ни один пункт,
      // — а человек стоит на одном из них.
      expect(monthStrip(['2026-07', '2026-08'], '2026-09')).toEqual([
        '2026-07',
        '2026-08',
        '2026-09',
      ]);
    });

    it('месяцы идут по возрастанию и без повторов', () => {
      expect(monthStrip(['2026-09', '2026-07', '2026-09'], '2026-09')).toEqual([
        '2026-07',
        '2026-09',
      ]);
    });

    it('год дописывается только чужой', () => {
      // В полосе из трёх соседних месяцев одного года год — шум; на
      // переходе через Новый год без него порядок не прочесть.
      expect(monthShort('2026-08', '2026-09')).toBe('авг.');
      expect(monthShort('2025-12', '2026-01')).toBe('дек. 2025');
      expect(monthInWords('2026-08', '2026-09')).toBe('августе');
      expect(monthInWords('2025-12', '2026-01')).toBe('декабре 2025');
    });
  });
});

/**
 * Пустой месяц объясняется словами, а не пустой сеткой.
 *
 * Пустая сетка одинаково читается как «в этом месяце ничего не стоит»,
 * как «данные не доехали» и как «сломалось». Разница между ними — это
 * разные действия человека, и экран обязан её называть.
 */
describe('ProjectCalendarComponent: пустой месяц', () => {
  function setup(month: string, days: CalendarDay[], months: string[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ProjectCalendarComponent);
    fixture.componentRef.setInput('month', month);
    fixture.componentRef.setInput('days', days);
    fixture.componentRef.setInput('months', months);
    fixture.detectChanges();
    return fixture;
  }

  const day: CalendarDay = {
    date: '2026-09-11T00:00:00Z',
    planned: 0,
    published: 1,
    items: [
      {
        publication_id: 'p1',
        creator_user_id: 'c1',
        creator_name: 'Анастасия',
        status: 'published',
      },
    ],
  };

  it('в пустом месяце сказано, где выкладки есть, и туда можно уйти', () => {
    const fixture = setup('2026-09', [], ['2026-07', '2026-08']);
    const text: string = fixture.nativeElement.textContent;

    expect(text).toContain('В сентябре выкладок нет');
    expect(text).toContain('Показать августе');

    const jump: HTMLButtonElement = fixture.nativeElement.querySelector('.jump');
    let asked = '';
    fixture.componentInstance.monthChange.subscribe((m: string) => (asked = m));
    jump.click();
    expect(asked)
      .withContext('кнопка обязана уводить в месяц с выкладками, а не листать на один')
      .toBe('2026-08');
  });

  it('выкладок нет во всём проекте — про соседние месяцы молчим', () => {
    const fixture = setup('2026-09', [], []);
    const text: string = fixture.nativeElement.textContent;

    expect(text).toContain('Выкладок в проекте пока нет');
    expect(text).not.toContain('Показать');
    expect(fixture.nativeElement.querySelector('.jump')).toBeNull();
  });

  /**
   * Самый коварный случай: месяц НЕ пуст, но показывает малую часть.
   * Одна точка в сентябре при десяти выкладках в августе читается как
   * «выкладок нет» ровно так же, как пустая сетка.
   */
  it('непустой месяц всё равно говорит, в каких месяцах ещё есть выкладки', () => {
    const fixture = setup('2026-09', [day], ['2026-07', '2026-08', '2026-09']);
    const strip: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.mbtn'));

    expect(strip.map((b) => b.textContent?.trim())).toEqual(['июл.', 'авг.', 'сен.']);
    expect(strip.filter((b) => b.classList.contains('on')).length)
      .withContext('показанный месяц в полосе отмечен ровно один')
      .toBe(1);
  });

  it('месяц без выкладок в полосе помечен как пустой', () => {
    const fixture = setup('2026-09', [], ['2026-08']);
    const current: HTMLElement = fixture.nativeElement.querySelector('.mbtn.on');
    expect(current.classList)
      .withContext('обещать содержимое пустого месяца нельзя')
      .toContain('void');
  });

  it('единственный месяц полосы не рисует', () => {
    // Полоса из одного пункта сообщала бы только то, что уже написано
    // заголовком сетки.
    const fixture = setup('2026-09', [day], ['2026-09']);
    expect(fixture.nativeElement.querySelector('.months')).toBeNull();
  });
});
