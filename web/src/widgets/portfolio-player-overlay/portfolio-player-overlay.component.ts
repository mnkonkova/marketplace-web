import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { FeedViewComponent } from '@widgets/feed-view/feed-view.component';
import { FeedParams } from '@entities/feed/model/feed.types';

@Component({
  selector: 'app-portfolio-player-overlay',
  standalone: true,
  imports: [FeedViewComponent],
  templateUrl: './portfolio-player-overlay.component.html',
  styleUrl: './portfolio-player-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioPlayerOverlayComponent {
  /** user_id специалиста — feed-view фильтруется через ids=[specialistId]. */
  public readonly specialistId = input.required<string>();

  /** Заголовок (имя спеца) — выводится в шапке feed-view. */
  public readonly title = input<string>('Работы');

  public readonly close = output<void>();

  public readonly feedParams = computed<FeedParams>(() => ({
    ids: [this.specialistId()],
  }));

  constructor() {
    // Лочим body-скролл, пока overlay открыт. Auto-revert при destroy.
    if (typeof document !== 'undefined') {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      inject(DestroyRef).onDestroy(() => {
        document.body.style.overflow = prev;
      });
    }
  }

  /** Esc и system back закрывают overlay. */
  @HostListener('document:keydown.escape')
  public onEscape(): void {
    this.close.emit();
  }

  public onClose(): void {
    this.close.emit();
  }
}
