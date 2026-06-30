import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';

/** Соответствует $touch в shared/scss/_breakpoints.scss. */
const TOUCH_QUERY = '(pointer: coarse), (max-width: 720px)';

@Component({
  selector: 'app-portfolio-grid',
  standalone: true,
  templateUrl: './portfolio-grid.component.html',
  styleUrl: './portfolio-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioGridComponent {
  public readonly items = input<PortfolioItem[]>([]);

  /** Map<category_code, title> — родитель передаёт чтобы чип показывал
   *  читаемое название. Если код не найден — используется сам код. */
  public readonly categoryTitles = input<Record<string, string>>({});

  /** Тап по любой плитке (на любом устройстве) просит родителя открыть
   *  fullscreen feed-view overlay со swipe-листанием работ. idx — индекс. */
  public readonly openOverlay = output<number>();

  /** Touch-режим (только для CSS-таргетинга grid-cols 2/3). */
  public readonly isTouch = signal(false);

  constructor() {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(TOUCH_QUERY);
    this.isTouch.set(mql.matches);
    const handler = (e: MediaQueryListEvent): void => this.isTouch.set(e.matches);
    mql.addEventListener('change', handler);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', handler));
  }

  public requestOverlay(idx: number): void {
    this.openOverlay.emit(idx);
  }

  public categoryLabel(code: string): string {
    return this.categoryTitles()[code] ?? code;
  }
}
