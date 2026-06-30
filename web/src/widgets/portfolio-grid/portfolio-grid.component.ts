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
import { formatDuration } from '@shared/lib/format';

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

  /** На тачах тап по тайлу не играет видео inline, а просит родителя
   *  открыть fullscreen-плеер. idx — индекс ролика в items[]. */
  public readonly openOverlay = output<number>();

  /** Photo-set: тап по тайлу открывает lightbox с каруселью. Родитель
   *  получает индекс айтема в items[] — достаёт images и передаёт в lightbox. */
  public readonly openPhotoSet = output<number>();

  public readonly formatDuration = formatDuration;

  public readonly playingIds = signal<ReadonlySet<string>>(new Set());

  /** Touch-режим: тачскрин ИЛИ узкий вьюпорт (resize-окно на десктопе).
   *  Реактивно реагирует на изменение matchMedia (поворот / resize). */
  public readonly isTouch = signal(false);

  constructor() {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(TOUCH_QUERY);
    this.isTouch.set(mql.matches);
    const handler = (e: MediaQueryListEvent): void => this.isTouch.set(e.matches);
    mql.addEventListener('change', handler);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', handler));
  }

  public startPlayback(v: HTMLVideoElement): void {
    v.play().catch(() => {});
  }

  public onPlay(id: string): void {
    this.playingIds.update((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }

  public onPause(id: string): void {
    this.playingIds.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  public requestOverlay(idx: number): void {
    this.openOverlay.emit(idx);
  }

  public requestPhotoSet(idx: number): void {
    this.openPhotoSet.emit(idx);
  }
}
