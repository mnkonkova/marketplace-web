import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { formatDuration } from '@shared/lib/format';

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

  public readonly formatDuration = formatDuration;

  public readonly playingIds = signal<ReadonlySet<string>>(new Set());

  /** Тачи определяем по pointer-метрике. На десктоп-тачскринах (Surface)
   *  попадёт в touch — для них тоже удобнее overlay-режим. */
  public readonly isTouch = signal(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );

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
}
