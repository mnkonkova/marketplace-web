import { TestBed } from '@angular/core/testing';

import type { PublicationReport } from '@entities/publication/model/publication.types';
import { ProjectStatsComponent } from '@widgets/project-stats/project-stats.component';

/**
 * График просмотров подписан тем, что в нём лежит.
 *
 * `by_day` — НАКОПИТЕЛЬНЫЙ ряд: точка дня это «всего просмотров на эту
 * дату», а не прирост за сутки (viewsByDay в internal/publications/
 * report.go переносит последнее известное значение каждой ссылки).
 * Подписи «Просмотры за день» и «максимум за день» превращали итог
 * проекта в рекордный день: рядом стояло «всего 3 000 000, +1 000 000 за
 * сутки», и одно из двух чисел обязано было быть враньём.
 */
describe('ProjectStatsComponent: график', () => {
  function report(over: Partial<PublicationReport> = {}): PublicationReport {
    return {
      project_id: 'pr1',
      as_of: '2026-09-14T10:00:00Z',
      videos: 1,
      views: 3_000_000,
      likes: 90_000,
      comments: 9_000,
      er_percent: 3.3,
      growth_24h: 1_000_000,
      collapsed: false,
      by_day: [
        { date: '2026-09-13', views: 2_000_000 },
        { date: '2026-09-14', views: 3_000_000 },
      ],
      by_platform: [],
      by_creator: [],
      videos_table: [],
      ...over,
    };
  }

  /** Накопительный ряд на n дней подряд, начиная с 1 сентября. */
  function days(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      views: (i + 1) * 100_000,
    }));
  }

  function setup(r: PublicationReport | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ProjectStatsComponent);
    fixture.componentRef.setInput('report', r);
    fixture.detectChanges();
    return fixture;
  }

  it('подпись графика говорит про накопительный ряд, а не про день', () => {
    const fixture = setup(report());
    const text: string = fixture.nativeElement.textContent;

    expect(text).toContain('нарастающим итогом');
    // Ряд накопительный — «за день» про него сказать нельзя ни в легенде,
    // ни в подписи максимума.
    expect(text).not.toContain('за день');
  });

  it('подпись под графиком — итог на последнюю дату, а не «максимум дня»', () => {
    const fixture = setup(report());
    const cmp = fixture.componentInstance;

    // Последняя точка накопительного ряда совпадает с итогом проекта:
    // именно это и делает «максимум за день» бессмысленным.
    expect(cmp.lastPoint()?.views).toBe(3_000_000);
    expect(cmp.lastPoint()?.views).toBe(report().views);
  });

  // Прятать переключатель на коротком ряде нельзя — его тогда не найти
  // вовсе. Но и молчать нельзя: обе кнопки нарисуют одно и то же, и
  // переключатель прочитается как сломанный.
  it('на коротком ряде переключатель остаётся, но говорит, за сколько дней числа', () => {
    const short = setup(report());
    expect(short.componentInstance.shortSeries()).toBeTrue();
    expect(short.componentInstance.seriesDays()).toBe(2);
    expect(short.nativeElement.textContent).toContain('пока за 2 дня');

    const long = setup(report({ by_day: days(12) }));
    expect(long.componentInstance.shortSeries()).toBeFalse();
    expect(long.nativeElement.textContent).not.toContain('пока за');
  });

  it('«7 дней» режет ряд до последней недели, «30» возвращает месяц', () => {
    const fixture = setup(report({ by_day: days(12) }));
    const cmp = fixture.componentInstance;

    expect(cmp.days().length).toBe(12);

    cmp.setRange(7);
    fixture.detectChanges();
    expect(cmp.days().length).toBe(7);
    // Режем ХВОСТ: неделя — это последние семь дней, а не первые.
    expect(cmp.days()[cmp.days().length - 1].date).toBe('2026-09-12');

    cmp.setRange(30);
    fixture.detectChanges();
    expect(cmp.days().length).toBe(12);
  });

  it('у графика говорящая подпись для скринридера', () => {
    const fixture = setup(report());
    const svg: SVGElement = fixture.nativeElement.querySelector('.chart svg');

    expect(svg.getAttribute('aria-label')).toBe('Просмотры нарастающим итогом');
  });
});
