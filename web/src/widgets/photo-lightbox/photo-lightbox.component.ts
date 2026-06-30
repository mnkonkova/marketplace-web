import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PortfolioImage } from '@entities/specialist/model/specialist.types';

@Component({
  selector: 'app-photo-lightbox',
  standalone: true,
  templateUrl: './photo-lightbox.component.html',
  styleUrl: './photo-lightbox.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoLightboxComponent {
  public readonly images = input<PortfolioImage[]>([]);
  public readonly title = input<string>('');
  public readonly initialIndex = input<number>(0);

  public readonly close = output<void>();

  public readonly index = signal(0);
  public readonly track = viewChild<ElementRef<HTMLElement>>('track');

  public readonly hasMany = computed(() => this.images().length > 1);
  public readonly canPrev = computed(() => this.index() > 0);
  public readonly canNext = computed(() => this.index() < this.images().length - 1);

  constructor() {
    effect(() => {
      // Если initialIndex пришёл позже images — синхронизируем.
      const init = this.initialIndex();
      if (init >= 0 && init < this.images().length) this.index.set(init);
    });
  }

  public goPrev(): void {
    if (!this.canPrev()) return;
    this.index.set(this.index() - 1);
    this.scrollToIndex();
  }

  public goNext(): void {
    if (!this.canNext()) return;
    this.index.set(this.index() + 1);
    this.scrollToIndex();
  }

  public closeOnBackdrop(ev: MouseEvent): void {
    // Закрываем только если клик прямо по backdrop'у — не по картинке/кнопке.
    if (ev.target === ev.currentTarget) this.close.emit();
  }

  // Синхронизируем index при свайпе/скролле (touch).
  public onTrackScroll(ev: Event): void {
    const el = ev.currentTarget as HTMLElement;
    const w = el.clientWidth || 1;
    const idx = Math.round(el.scrollLeft / w);
    if (idx !== this.index()) this.index.set(idx);
  }

  @HostListener('document:keydown.escape')
  public onEsc(): void {
    this.close.emit();
  }

  @HostListener('document:keydown.arrowLeft')
  public onArrowLeft(): void {
    this.goPrev();
  }

  @HostListener('document:keydown.arrowRight')
  public onArrowRight(): void {
    this.goNext();
  }

  private scrollToIndex(): void {
    const el = this.track()?.nativeElement;
    if (!el) return;
    const w = el.clientWidth;
    el.scrollTo({ left: this.index() * w, behavior: 'smooth' });
  }
}
