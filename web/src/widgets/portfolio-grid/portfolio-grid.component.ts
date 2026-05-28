import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
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

  public readonly formatDuration = formatDuration;

  public readonly playingIds = signal<ReadonlySet<string>>(new Set());

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
}
