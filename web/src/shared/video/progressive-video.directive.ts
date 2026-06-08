import {
  DestroyRef,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, fromEvent, merge, timer } from 'rxjs';
import { filter, first, switchMap, takeUntil } from 'rxjs/operators';

import { ProgressiveUpgradeService } from './progressive-upgrade.service';

/** Когда триггерить загрузку full-варианта. */
export type UpgradeTrigger =
  /** Параллельно с preview, без задержки. */
  | 'immediate'
  /** Через 2 сек после `loadeddata` preview'a (дефолт). */
  | 'onPlay-2s'
  /** На `mouseenter` контейнера preview'a. */
  | 'onHover'
  /** Когда элемент ≥50% в viewport (IntersectionObserver). */
  | 'onIntersect-50%'
  /** Только через .upgrade() вручную. */
  | 'manual';

interface NetworkConnection {
  saveData?: boolean;
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
}

/**
 * Прогрессивное улучшение качества видео: показывает preview
 * (~500KB 480p) для мгновенного TTFB, в фоне грузит оригинал и
 * бесшовно переключается когда тот готов.
 *
 * Архитектура: см. docs/PROGRESSIVE_VIDEO_PLAYBACK.md.
 *
 * Использование:
 * ```html
 * <video
 *   appProgressiveVideo
 *   [previewSrc]="video.preview_url"
 *   [fullSrc]="video.url"
 *   upgradeTrigger="onPlay-2s"
 *   autoplay loop muted playsinline></video>
 * ```
 *
 * Edge cases:
 * - data-saver mode → пропускаем апгрейд forever
 * - slow-2g / 2g → пропускаем апгрейд
 * - юзер ушёл со страницы → отменяем загрузку full
 * - full крякнулся → молча остаёмся на preview
 *
 * Глобальный rate-limiter в ProgressiveUpgradeService держит максимум
 * 2 параллельных апгрейда — фид с 10 карточками не повесит сеть.
 */
@Directive({
  selector: 'video[appProgressiveVideo]',
  standalone: true,
})
export class ProgressiveVideoDirective implements OnInit {
  @Input({ required: true }) previewSrc!: string;
  @Input({ required: true }) fullSrc!: string;
  @Input() upgradeTrigger: UpgradeTrigger = 'onPlay-2s';

  /** Эмитится когда swap к full успешно произошёл. Для аналитики. */
  @Output() qualityUpgraded = new EventEmitter<void>();

  private readonly host = inject<ElementRef<HTMLVideoElement>>(ElementRef);
  private readonly upgradeService = inject(ProgressiveUpgradeService);
  private readonly destroyRef = inject(DestroyRef);

  private fullEl: HTMLVideoElement | null = null;
  private readonly destroyed$ = new Subject<void>();
  private upgraded = false;

  public ngOnInit(): void {
    const preview = this.host.nativeElement;
    // Если src уже задан в шаблоне — оставляем, иначе ставим preview.
    if (!preview.getAttribute('src')) {
      preview.src = this.previewSrc;
    }

    this.destroyRef.onDestroy(() => {
      this.destroyed$.next();
      this.destroyed$.complete();
      this.cancelFullLoad();
    });

    if (this.shouldSkipUpgrade()) {
      // Data-saver / slow-2g — preview forever.
      return;
    }

    if (this.upgradeTrigger === 'manual') {
      return; // ждём явного .upgrade()
    }

    this.scheduleUpgrade();
  }

  /** Триггерит upgrade вручную. Игнорится если уже сделали upgrade. */
  public upgrade(): void {
    if (this.upgraded || this.fullEl) return;
    void this.startUpgrade();
  }

  private scheduleUpgrade(): void {
    const preview = this.host.nativeElement;

    switch (this.upgradeTrigger) {
      case 'immediate':
        void this.startUpgrade();
        return;

      case 'onPlay-2s':
        // Ждём loadeddata + 2 сек "интереса" (юзер реально смотрит).
        fromEvent(preview, 'loadeddata')
          .pipe(
            first(),
            switchMap(() => timer(2000)),
            takeUntil(this.destroyed$),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(() => void this.startUpgrade());
        return;

      case 'onHover':
        // Hover работает только на desktop'ах. На тач — никогда.
        if (matchMedia('(hover: none)').matches) return;
        fromEvent<MouseEvent>(preview, 'mouseenter')
          .pipe(first(), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => void this.startUpgrade());
        return;

      case 'onIntersect-50%': {
        if (typeof IntersectionObserver === 'undefined') {
          void this.startUpgrade();
          return;
        }
        const io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting && e.intersectionRatio >= 0.5) {
                io.disconnect();
                void this.startUpgrade();
                return;
              }
            }
          },
          { threshold: [0.5] },
        );
        io.observe(preview);
        merge(this.destroyed$).subscribe(() => io.disconnect());
        return;
      }
    }
  }

  private async startUpgrade(): Promise<void> {
    if (this.upgraded || this.fullEl) return;

    const release = await this.upgradeService.acquire();
    // Если за время ожидания директиву убили — отдаём слот обратно.
    if (this.destroyed$.closed) {
      release();
      return;
    }

    const preview = this.host.nativeElement;
    const full = document.createElement('video');
    full.muted = preview.muted;
    full.playsInline = preview.playsInline;
    full.loop = preview.loop;
    full.preload = 'auto';
    // Копируем CSS-классы и стили хоста чтобы full занял ту же
    // позицию что preview. Делаем абсолютным поверх preview, чтобы
    // не дёргать layout.
    full.style.position = 'absolute';
    full.style.top = '0';
    full.style.left = '0';
    full.style.width = '100%';
    full.style.height = '100%';
    full.style.objectFit = getComputedStyle(preview).objectFit || 'cover';
    full.style.opacity = '0';
    full.style.transition = 'opacity 300ms ease';
    full.style.pointerEvents = 'none';

    this.fullEl = full;
    full.src = this.fullSrc;

    // Контейнер должен иметь position: relative — иначе абсолютный
    // full уплывёт к ближайшему позиционированному предку. Подмазываем
    // если родитель не позиционирован.
    const parent = preview.parentElement;
    if (parent) {
      const parentPos = getComputedStyle(parent).position;
      if (parentPos === 'static') parent.style.position = 'relative';
      parent.appendChild(full);
    }

    const cleanup = (err?: unknown) => {
      release();
      if (err && this.fullEl) {
        this.fullEl.remove();
        this.fullEl = null;
      }
    };

    // visibilitychange — если юзер ушёл с табы, отменяем загрузку.
    fromEvent(document, 'visibilitychange')
      .pipe(
        filter(() => document.hidden),
        takeUntil(this.destroyed$),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.cancelFullLoad());

    // canplaythrough — полное буферизирование, можно играть без stutter.
    // Используем именно canplaythrough (не canplay), чтобы первый
    // кадр после swap не подвис.
    fromEvent(full, 'canplaythrough')
      .pipe(first(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.performSwap(cleanup));

    fromEvent(full, 'error')
      .pipe(first(), takeUntilDestroyed(this.destroyRef))
      .subscribe((err) => cleanup(err));

    // Sanity-таймаут 30с: если за полминуты full не довёл canplaythrough,
    // что-то сильно не так (огромный файл / тормозной CDN). Отдаём слот
    // следующему, остаёмся на preview.
    timer(30_000)
      .pipe(takeUntil(this.destroyed$), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.upgraded) cleanup('timeout');
      });
  }

  private performSwap(cleanup: (err?: unknown) => void): void {
    if (!this.fullEl) return;
    const preview = this.host.nativeElement;
    const full = this.fullEl;

    // Синхронизируем время — preview мог проиграть N секунд, и юзер
    // ожидает что full продолжит с того же места (хотя обычно для loop'a
    // это не важно).
    try {
      full.currentTime = preview.currentTime % (full.duration || preview.duration || 1);
    } catch {
      // Edge: full.duration ещё NaN — играем с 0.
    }

    // Начинаем full в синхроне с fade-in.
    full
      .play()
      .then(() => {
        full.style.opacity = '1';
        // Через 300мс убираем preview из DOM — анимация opacity завершилась.
        setTimeout(() => {
          if (!preview.isConnected) return;
          // Чтобы избежать «двух одинаковых видео» — паузим preview.
          preview.pause();
          // src на null чтобы освободить декодер.
          preview.removeAttribute('src');
          preview.load();
          // Оставляем preview-элемент в DOM (это `this.host` и удалять
          // его нельзя — это сам хост директивы), но скрываем.
          preview.style.display = 'none';
        }, 320);

        this.upgraded = true;
        this.qualityUpgraded.emit();
        cleanup();
      })
      .catch((err) => cleanup(err));
  }

  private cancelFullLoad(): void {
    if (!this.fullEl) return;
    try {
      this.fullEl.pause();
      this.fullEl.removeAttribute('src');
      this.fullEl.load();
      this.fullEl.remove();
    } catch {
      /* swallow */
    }
    this.fullEl = null;
  }

  private shouldSkipUpgrade(): boolean {
    // navigator.connection — экспериментальный API, есть в Chrome/
    // Edge/Opera. Safari/Firefox не имеют — fallback "не пропускаем".
    const conn = (navigator as Navigator & { connection?: NetworkConnection }).connection;
    if (!conn) return false;
    if (conn.saveData) return true;
    if (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g') return true;
    return false;
  }
}
