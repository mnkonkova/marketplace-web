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

  it('у графика говорящая подпись для скринридера', () => {
    const fixture = setup(report());
    const svg: SVGElement = fixture.nativeElement.querySelector('.chart svg');

    expect(svg.getAttribute('aria-label')).toBe('Просмотры нарастающим итогом');
  });
});
