import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
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

  /** id работы, с которой открыть плеер (клик по конкретной плитке). */
  public readonly startItemId = input<string>('');

  public readonly close = output<void>();

  public readonly feedParams = computed<FeedParams>(() => ({
    ids: [this.specialistId()],
  }));

  // Touch-detect для swipe-hint текста (свайп vs скролл/стрелки).
  public readonly isTouch = signal(
    typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse), (max-width: 720px)').matches,
  );

  // Подсказка «листайте» — одноразово, сохраняется в localStorage. Если
  // юзер уже видел, повторно не показываем.
  private static readonly HINT_STORAGE_KEY = 'marketpclce.feed_swipe_hint_seen.v1';
  public readonly showSwipeHint = signal(false);
  private hintTimer?: ReturnType<typeof setTimeout>;

  /** Истина если overlay закрылся через browser back gesture / hardware-back —
   *  не дёргать history.back() второй раз при destroy, чтобы не уехать
   *  ещё на одну страницу назад. */
  private closedByPopstate = false;

  private readonly popstateHandler = (): void => {
    this.closedByPopstate = true;
    this.close.emit();
  };

  constructor() {
    if (typeof document !== 'undefined') {
      // Body-scroll lock пока открыт overlay.
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      // Push history entry — браузерный «назад» (или iOS edge-swipe-back)
      // вернётся к нашему current URL, тригернет popstate → close overlay,
      // и юзер останется на странице спеца. Без этого back уводил вообще
      // со страницы (на /search или search-results).
      history.pushState({ overlay: 'portfolio-player' }, '');
      window.addEventListener('popstate', this.popstateHandler);

      // Swipe-hint первому юзеру. localStorage флаг чтобы не повторять.
      try {
        if (!localStorage.getItem(PortfolioPlayerOverlayComponent.HINT_STORAGE_KEY)) {
          this.showSwipeHint.set(true);
          // Скрыть через 4 сек или по любому скроллу/тачу в overlay.
          this.hintTimer = setTimeout(() => this.dismissHint(), 4000);
          window.addEventListener('wheel', this.dismissHintOnce, { once: true, passive: true });
          window.addEventListener('touchstart', this.dismissHintOnce, { once: true, passive: true });
          window.addEventListener('keydown', this.dismissHintOnce, { once: true });
        }
      } catch {
        // SSR / iframe / privacy mode без localStorage — пропускаем hint.
      }

      inject(DestroyRef).onDestroy(() => {
        document.body.style.overflow = prevOverflow;
        window.removeEventListener('popstate', this.popstateHandler);
        if (this.hintTimer) clearTimeout(this.hintTimer);
        window.removeEventListener('wheel', this.dismissHintOnce);
        window.removeEventListener('touchstart', this.dismissHintOnce);
        window.removeEventListener('keydown', this.dismissHintOnce);
        // Если destroy сработал НЕ из popstate (юзер нажал × / Esc /
        // back-кнопку в overlay'е) — наш push-entry нужно убрать,
        // иначе следующий browser back сначала «вернёт» в наш overlay-state
        // (на котором уже ничего нет, страница уже back-navigation'ом туда
        // не вернётся, но history-stack засорится).
        if (!this.closedByPopstate) {
          history.back();
        }
      });
    }
  }

  /** Esc закрывает overlay. */
  @HostListener('document:keydown.escape')
  public onEscape(): void {
    this.close.emit();
  }

  public onClose(): void {
    this.close.emit();
  }

  private dismissHint(): void {
    if (!this.showSwipeHint()) return;
    this.showSwipeHint.set(false);
    try {
      localStorage.setItem(PortfolioPlayerOverlayComponent.HINT_STORAGE_KEY, '1');
    } catch {
      /* swallow */
    }
  }

  // Bind как property чтобы removeEventListener'у указать тот же reference.
  private readonly dismissHintOnce = (): void => this.dismissHint();
}
