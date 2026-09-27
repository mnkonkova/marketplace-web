import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { CalendarDay, CalendarItem } from '@entities/publication/model/publication.types';
import {
  CalendarPerson,
  ProjectCalendarComponent,
} from '@widgets/project-calendar/project-calendar.component';

/**
 * Календарь отвечает на «кто и когда снимает», а не только «сколько».
 *
 * Точки состояния (вышло / запланировано) говорили, что в этот день
 * что-то есть, но не кто: имена показывались лишь по клику на день, и
 * календарь читался как пустой план. Лица в клетке — тот же состав
 * периода, что и в блоке «Кто снимал», и берутся они оттуда же: в самой
 * записи календаря портретов нет.
 */
describe('ProjectCalendarComponent: лица в днях', () => {
  function item(over: Partial<CalendarItem> = {}): CalendarItem {
    return {
      publication_id: 'p1',
      creator_user_id: 'u1',
      creator_name: 'Аня Ким',
      status: 'published',
      ...over,
    };
  }

  function setup(days: CalendarDay[], people: Record<string, CalendarPerson> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ProjectCalendarComponent);
    fixture.componentRef.setInput('month', '2026-09');
    fixture.componentRef.setInput('days', days);
    fixture.componentRef.setInput('people', people);
    fixture.detectChanges();
    return fixture;
  }

  const day = (over: Partial<CalendarDay> = {}): CalendarDay => ({
    date: '2026-09-10',
    planned: 0,
    published: 1,
    items: [item()],
    ...over,
  });

  it('в день с выкладкой попадает лицо того, кто снимает', () => {
    const fixture = setup([day()]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.cell .faces .face').length).toBe(1);
  });

  it('портрет берётся из состава периода, без него остаётся буква', () => {
    const withPhoto = setup([day()], {
      u1: { name: 'Аня Ким', avatar_url: 'https://cdn.example/ann.jpg' },
    });
    const img = (withPhoto.nativeElement as HTMLElement).querySelector<HTMLImageElement>(
      '.cell .faces img.face',
    );
    expect(img?.src).toBe('https://cdn.example/ann.jpg');

    const noPhoto = setup([day()]);
    const letter = (noPhoto.nativeElement as HTMLElement).querySelector(
      '.cell .faces .face.letter',
    );
    expect(letter?.textContent?.trim()).toBe('А');
  });

  it('один человек с двумя роликами — одно лицо, а не два', () => {
    const cmp = setup([
      day({
        published: 2,
        items: [item(), item({ publication_id: 'p2' })],
      }),
    ]).componentInstance;
    const cell = cmp.cells().find((c) => c.date === '2026-09-10')!;
    expect(cmp.faces(cell).length).toBe(1);
  });

  it('больше трёх человек в день — остаток показываем числом', () => {
    const many = [0, 1, 2, 3, 4].map((i) =>
      item({ publication_id: `p${i}`, creator_user_id: `u${i}`, creator_name: `Креатор ${i}` }),
    );
    const fixture = setup([day({ published: 5, items: many })]);
    const cmp = fixture.componentInstance;
    const cell = cmp.cells().find((c) => c.date === '2026-09-10')!;
    expect(cmp.facesShown(cell).length).toBe(3);
    expect(cmp.facesRest(cell)).toBe(2);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.cell .faces .face.rest')?.textContent?.trim()).toBe('+2');
  });

  /**
   * Мёртвых ссылок в календаре быть не должно по тому же правилу, что и
   * в составе: страница специалиста живёт только у опубликованного
   * профиля, на остальное ручка отдаёт 404.
   */
  it('ссылка на страницу ставится только тем, у кого она есть', () => {
    const cmp = setup([day()], {
      u1: { name: 'Аня Ким', link: ['/specialist', 'ann'] },
    }).componentInstance;
    expect(cmp.personLink(item())).toEqual(['/specialist', 'ann']);
    expect(cmp.personLink(item({ creator_user_id: 'u9' }))).toBeNull();
  });

  it('пустой день лиц не рисует', () => {
    const fixture = setup([day({ published: 0, planned: 0, items: [] })]);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.faces').length).toBe(0);
  });
});
