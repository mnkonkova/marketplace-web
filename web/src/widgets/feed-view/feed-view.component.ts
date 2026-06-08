import {
  AfterViewInit,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { FeedApi } from '@entities/feed/api/feed.api';
import { FeedItem, FeedParams, FeedResponse } from '@entities/feed/model/feed.types';
import { feedVideoPreviewSrc } from '@entities/feed/lib/preview';
import {
  ProgressiveUpgradeController,
  enableProgressiveUpgrade,
} from '@shared/video/progressive-upgrade';
import { ProgressiveUpgradeService } from '@shared/video/progressive-upgrade.service';
import { CategoryApi } from '@entities/category/api/category.api';
import { formatDuration, formatRate } from '@shared/lib/format';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { SpecialistLite } from '@entities/specialist/model/specialist.types';
import { RateStarsComponent } from '@widgets/rate-stars/rate-stars.component';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-feed-view',
  standalone: true,
  imports: [NzButtonModule, NzIconModule, NzSpinModule, RateStarsComponent],
  templateUrl: './feed-view.component.html',
  styleUrl: './feed-view.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class FeedViewComponent implements AfterViewInit, OnDestroy {
  public readonly params = input<FeedParams>({});

  public readonly title = input('Лента');

  public readonly specialistClick = output<SpecialistLite>();

  private readonly feedApi = inject(FeedApi);

  private readonly categoryApi = inject(CategoryApi);

  private readonly cart = inject(ProjectCartStore);

  private readonly upgradeService = inject(ProgressiveUpgradeService);

  public readonly cartSpecialists = this.cart.specialists;

  /**
   * Активные progressive-upgrade controllers — по одному на каждую
   * карточку с видео. Чистим при resetFeed/destroy чтобы не утекало.
   */
  private readonly videoUpgrades = new Map<HTMLElement, ProgressiveUpgradeController>();

  private readonly injector = inject(Injector);

  private readonly hostEl = inject(ElementRef<HTMLElement>).nativeElement;

  public readonly listRef = viewChild<ElementRef<HTMLElement>>('list');

  private headerResizeObserver?: ResizeObserver;

  private paginationObserver?: IntersectionObserver;

  private paginationSentinel?: HTMLElement;
  /** Индекс sentinel, для которого уже запросили следующую страницу. */
  private paginationTriggeredAt = -1;

  public readonly videos = signal<FeedItem[]>([]);

  public readonly loading = signal(false);

  public readonly done = signal(false);

  public readonly muted = signal(localStorage.getItem('marketpclce.feed_muted.v1') !== 'off');

  public readonly empty = signal(false);

  private nextCursor = '';

  private observer?: IntersectionObserver;

  private activeArticle: HTMLElement | null = null;

  private categoryTitles = new Map<string, string>();

  private playbackStarted = false;

  public ngAfterViewInit(): void {
    this.syncAppHeaderHeight();
    this.categoryApi.list().subscribe((cats) => {
      for (const c of cats) this.categoryTitles.set(c.code, c.title);
    });
    this.resetFeed();
    this.loadNext();
  }

  public ngOnDestroy(): void {
    this.headerResizeObserver?.disconnect();
    this.observer?.disconnect();
    this.paginationObserver?.disconnect();
    this.pauseAll();
    this.disposeAllUpgrades();
  }

  /** Высота sticky app-header — чтобы лента не уезжала под viewport. */
  private syncAppHeaderHeight(): void {
    const header = document.querySelector<HTMLElement>('app-header .header');
    if (!header) {
      this.setAppHeaderHeight(0);
      return;
    }
    const apply = () => this.setAppHeaderHeight(header.offsetHeight);
    apply();
    this.headerResizeObserver?.disconnect();
    this.headerResizeObserver = new ResizeObserver(apply);
    this.headerResizeObserver.observe(header);
  }

  private setAppHeaderHeight(px: number): void {
    this.hostEl.style.setProperty('--app-header-height', `${Math.round(px)}px`);
  }

  public readonly formatRate = formatRate;

  public readonly formatDuration = formatDuration;

  public categoryTitle(code: string): string {
    return this.categoryTitles.get(code) ?? code;
  }

  public isInCart(userId: string): boolean {
    return this.cartSpecialists().some((s) => s.user_id === userId);
  }

  public toggleCart(spec: SpecialistLite, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.cart.toggle(spec);
  }

  // Tap по статье = play/pause. iOS Safari не выдаёт click на <video playsinline>
  // без controls стабильно, поэтому слушаем на родительском <article>.
  // Тапы по кнопкам overlay не должны паузить — отсекаем по closest('button, a').
  public togglePlayback(ev: Event): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('button, a')) return;
    const article = ev.currentTarget as HTMLElement;
    const video = article.querySelector<HTMLVideoElement>('video.feed-video');
    if (!video) return;
    if (video.paused) this.playVideo(article, video);
    else video.pause();
  }

  /** Горизонтальное видео (16:9 и т.п.) — letterbox по центру, как Shorts/Reels. */
  public isLandscape(it: FeedItem): boolean {
    const ratio = this.parseAspectRatio(it.video.aspect);
    return ratio != null ? ratio > 1 : false;
  }

  public toggleMute(): void {
    const next = !this.muted();
    this.muted.set(next);
    localStorage.setItem('marketpclce.feed_muted.v1', next ? 'on' : 'off');
    // user gesture от tap по кнопке — безопасный момент изменить muted
    // даже на iOS Safari (предыдущая позиция: muted ставился ТОЛЬКО в
    // ensureVideo как true, и здесь меняется только по тапу — autoplay
    // уже отработал, ограничения сняты).
    document.querySelectorAll<HTMLVideoElement>('.feed-video').forEach((v) => {
      v.muted = next;
      if (!next && v.paused) {
        // Если был muted и автостопнут (что редко) — поднимем заново.
        v.play().catch(() => {});
      }
    });
  }

  private resetFeed(): void {
    this.videos.set([]);
    this.nextCursor = '';
    this.done.set(false);
    this.empty.set(false);
    this.playbackStarted = false;
    this.activeArticle = null;
    this.paginationTriggeredAt = -1;
    this.detachPaginationSentinel();
    this.disposeAllUpgrades();
  }

  /**
   * Дёргает dispose() на всех progressive-upgrade controllers — отменяет
   * запланированные/идущие загрузки full-варианта, освобождает rate-slot'ы
   * глобального ProgressiveUpgradeService. Вызывается при reset feed'a
   * и при ngOnDestroy.
   */
  private disposeAllUpgrades(): void {
    for (const ctrl of this.videoUpgrades.values()) {
      try {
        ctrl.dispose();
      } catch {
        /* swallow */
      }
    }
    this.videoUpgrades.clear();
  }

  public loadNext(): void {
    if (this.loading() || this.done()) return;
    this.loading.set(true);
    const p: FeedParams = {
      ...this.params(),
      cursor: !this.nextCursor ? undefined : this.nextCursor,
    };
    this.feedApi
      .load(p)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe((res: FeedResponse) => {
        if (!res.items.length) {
          if (!this.videos().length) this.empty.set(true);
          this.done.set(true);
          this.detachPaginationSentinel();
          return;
        }
        this.videos.update((prev) => [...prev, ...res.items]);
        this.nextCursor = res.next_cursor ?? '';
        if (!res.next_cursor) {
          this.done.set(true);
          this.detachPaginationSentinel();
        }
        this.queuePlaybackSetup();
      });
  }

  /** Ждём отрисовки @for, иначе .feed-item ещё нет в DOM (гонка с setTimeout). */
  private queuePlaybackSetup(): void {
    afterNextRender(() => this.setupObserver(), { injector: this.injector });
  }

  private setupObserver(): void {
    const root = this.listRef()?.nativeElement;
    if (!root) return;
    this.observer?.disconnect();
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root,
      threshold: [0, 0.5, 0.75, 1],
    });
    root.querySelectorAll('.feed-item').forEach((el) => this.observer!.observe(el));
    const all = root.querySelectorAll('.feed-item');
    this.attachPaginationSentinel(root, all);
    if (!this.playbackStarted && all.length) {
      this.playbackStarted = true;
      root.scrollTop = 0;
      const first = all[0] as HTMLElement;
      first.scrollIntoView({ block: 'start' });
      this.activate(first);
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    const visible = entries
      .filter((e) => e.isIntersecting && e.intersectionRatio >= 0.5)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (!visible.length) return;
    const el = visible[0].target as HTMLElement;
    if (el !== this.activeArticle) this.activate(el);
  }

  private activate(article: HTMLElement): void {
    if (this.activeArticle && this.activeArticle !== article) {
      // querySelectorAll, не querySelector — после progressive-upgrade
      // в article может быть несколько <video> в переходном моменте
      // (preview перед удалением + full только что замененный).
      // Пауза всех — единственно надёжно, иначе звук «каши» при скролле.
      this.activeArticle.querySelectorAll('video').forEach((v) => v.pause());
    }
    this.activeArticle = article;
    const video = this.ensureVideo(article);
    if (video) {
      if (video.videoWidth) this.applyVideoOrientation(article, video);
      this.playVideo(article, video);
    }
    const idx = article.dataset['index'];
    const root = this.listRef()?.nativeElement;
    if (root && idx != null) {
      const i = parseInt(idx, 10);
      [-1, 0, 1].forEach((d) => {
        const neighbor = root.querySelector(`[data-index="${i + d}"]`) as HTMLElement | null;
        if (neighbor) this.ensureVideo(neighbor);
      });
    }
  }

  private ensureVideo(article: HTMLElement): HTMLVideoElement | null {
    let video = article.querySelector('video.feed-video') as HTMLVideoElement | null;
    if (video) {
      if (video.videoWidth) this.applyVideoOrientation(article, video);
      return video;
    }
    const idx = parseInt(article.dataset['index'] ?? '-1', 10);
    const item = this.videos()[idx];
    if (!item) return null;
    video = document.createElement('video');
    video.className = 'feed-video';
    video.playsInline = true;
    video.loop = true;
    video.preload = 'auto';
    // iOS Safari: autoplay работает ТОЛЬКО для muted-видео + только если
    // muted установлен ДО play() и без посторонних активаций. Стартуем
    // всегда muted=true (HTML-attribute через setAttribute — Safari иногда
    // игнорит .muted property без attribute), независимо от localStorage.
    // После toggleMute() (user gesture от кнопки) можно безопасно unmute —
    // это уже доверенный контекст. Иначе на iPhone видео висит на постере
    // пока не тапнут.
    video.muted = this.muted();
    if (this.muted()) {
      // HTML-атрибут muted нужен iOS Safari для autoplay-policy
      // (property недостаточно). Ставим только если префер юзера = muted —
      // иначе autoplay тоже не сработает на iOS, и нас выручит catch
      // в playVideo (он пробует muted=true фолбэком).
      video.setAttribute('muted', '');
    }
    video.setAttribute('playsinline', '');

    // Спиннер на время сетевой подгрузки. Снимаем на loadeddata (или error).
    article.classList.add('is-video-loading');

    const onReady = (): void => {
      article.classList.remove('is-video-loading');
      article.querySelector('.feed-poster')?.classList.add('is-hidden');
      if (this.activeArticle === article) this.playVideo(article, video);
    };
    const onFail = (): void => {
      article.classList.remove('is-video-loading');
      article.querySelector('.feed-poster')?.classList.remove('is-hidden');
    };

    // Listeners ВСЕГДА вешаем ДО присвоения src — иначе для закешированных
    // или быстрых ответов loadeddata срабатывает между src= и addEventListener,
    // мы его пропускаем и спиннер висит бесконечно.
    video.addEventListener('loadedmetadata', () => this.applyVideoOrientation(article, video));
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onFail);

    if (item.video.thumb) video.poster = item.video.thumb;
    // preview_url — облегчённое 480p ~500KB видео для autoplay в карточке;
    // фолбэк на оригинал когда транскод ещё не отработал. См.
    // entities/feed/lib/preview.ts (backend docs/VIDEO_TRANSCODING.md).
    const previewUrl = feedVideoPreviewSrc(item.video);
    video.src = previewUrl;

    // Подстраховка: если src уже отдал данные синхронно (memory-cache),
    // readyState ≥ 2 ещё ДО первого тика event loop — снимем спиннер сразу.
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      onReady();
    }

    const media = article.querySelector('.feed-media');
    if (media) media.appendChild(video);

    // Прогрессивное улучшение: если есть отдельный preview_url И отдельный
    // оригинал — через 2 сек после loadeddata подтягиваем оригинал в
    // фоне и бесшовно подменяем (cross-fade). Подробности — в
    // docs/PROGRESSIVE_VIDEO_PLAYBACK.md. Если preview_url == video.url
    // (транскод ещё не отработал) — апгрейдить нечего, скипаем.
    if (item.video.preview_url && item.video.url && item.video.preview_url !== item.video.url) {
      const ctrl = enableProgressiveUpgrade({
        preview: video,
        fullSrc: item.video.url,
        upgradeService: this.upgradeService,
        trigger: 'onPlay-2s',
      });
      this.videoUpgrades.set(article, ctrl);
    }

    return video;
  }

  private parseAspectRatio(aspect?: string): number | null {
    if (!aspect) return null;
    const parts = aspect.split(':').map((p) => parseFloat(p.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
    return parts[0] / parts[1];
  }

  private playVideo(article: HTMLElement, video: HTMLVideoElement): void {
    const start = (): void => {
      video.muted = this.muted();
      video.play().catch(() => {
        // iOS Safari: если muted=false и autoplay-policy блочит — фолбэк
        // на muted=true (молчаливо). Юзер потом тапнет unmute сам.
        if (!video.muted) {
          video.muted = true;
          video.play().catch(() => {});
        }
      });
    };
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      start();
      return;
    }
    const onReady = (): void => {
      video.removeEventListener('canplay', onReady);
      if (this.activeArticle === article) start();
    };
    video.addEventListener('canplay', onReady);
  }

  private applyVideoOrientation(article: HTMLElement, video: HTMLVideoElement): void {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const landscape = w > h;
    article.classList.toggle('is-landscape', landscape);
    article.classList.toggle('is-portrait', !landscape);
  }

  private pauseAll(): void {
    this.listRef()
      ?.nativeElement.querySelectorAll('video')
      .forEach((v) => v.pause());
  }

  /** Один observer на всю сессию; при подгрузке только меняем sentinel. */
  private attachPaginationSentinel(root: HTMLElement, items: NodeListOf<Element>): void {
    if (this.done() || !items.length) {
      this.detachPaginationSentinel();
      return;
    }
    const sentinel = items[Math.max(0, items.length - 2)] as HTMLElement;
    if (sentinel === this.paginationSentinel) return;
    this.detachPaginationSentinel();
    this.paginationSentinel = sentinel;
    if (!this.paginationObserver) {
      this.paginationObserver = new IntersectionObserver(
        (entries) => this.onPaginationIntersect(entries),
        { root, threshold: 0.25 },
      );
    }
    this.paginationObserver.observe(sentinel);
  }

  private onPaginationIntersect(entries: IntersectionObserverEntry[]): void {
    const entry = entries.find((e) => e.target === this.paginationSentinel);
    if (!entry?.isIntersecting || this.loading() || this.done()) return;
    const idx = parseInt((entry.target as HTMLElement).dataset['index'] ?? '-1', 10);
    if (idx < 0 || idx === this.paginationTriggeredAt) return;
    this.paginationTriggeredAt = idx;
    this.loadNext();
  }

  private detachPaginationSentinel(): void {
    if (this.paginationObserver && this.paginationSentinel) {
      this.paginationObserver.unobserve(this.paginationSentinel);
    }
    this.paginationSentinel = undefined;
  }
}
