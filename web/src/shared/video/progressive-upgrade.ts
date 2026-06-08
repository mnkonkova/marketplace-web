import type { ProgressiveUpgradeService } from './progressive-upgrade.service';

/** Когда триггерить загрузку full-варианта. */
export type UpgradeTrigger =
  | 'immediate'
  | 'onPlay-2s'
  | 'onHover'
  | 'onIntersect-50%'
  | 'manual';

export interface ProgressiveUpgradeOptions {
  /** Уже загруженный preview-элемент (видимый, играет). */
  preview: HTMLVideoElement;
  /** URL полноразмерного видео. */
  fullSrc: string;
  /** Сервис для глобального rate-limit. */
  upgradeService: ProgressiveUpgradeService;
  /** Триггер (см. UpgradeTrigger). По дефолту 'onPlay-2s'. */
  trigger?: UpgradeTrigger;
  /** Callback после успешного swap'a (для аналитики). */
  onUpgraded?: () => void;
}

/** Controller вернётся из enableProgressiveUpgrade — даёт ручное управление. */
export interface ProgressiveUpgradeController {
  /** Триггерит upgrade вручную (для trigger='manual'). */
  upgrade(): void;
  /** Отменить запланированный/идущий upgrade. Освобождает rate-slot. */
  dispose(): void;
}

/**
 * Императивный аналог [appProgressiveVideo] директивы — для случаев
 * когда `<video>` создаётся не из шаблона, а через `document.createElement`
 * (как в widgets/feed-view, где плеер собирается в TS).
 *
 * Архитектура и edge cases — см. docs/PROGRESSIVE_VIDEO_PLAYBACK.md.
 *
 * Использование:
 * ```ts
 * const video = document.createElement('video');
 * video.src = previewUrl;
 * // ... настройка autoplay/loop/muted ...
 * const ctrl = enableProgressiveUpgrade({
 *   preview: video,
 *   fullSrc: fullUrl,
 *   upgradeService: this.upgradeService,
 *   trigger: 'onPlay-2s',
 * });
 * // При уничтожении компонента:
 * ctrl.dispose();
 * ```
 */
export function enableProgressiveUpgrade(
  opts: ProgressiveUpgradeOptions,
): ProgressiveUpgradeController {
  const { preview, fullSrc, upgradeService, trigger = 'onPlay-2s', onUpgraded } = opts;

  let fullEl: HTMLVideoElement | null = null;
  let upgraded = false;
  let disposed = false;
  let releaseSlot: (() => void) | null = null;
  const listeners: Array<() => void> = [];
  let upgradeTimer: ReturnType<typeof setTimeout> | null = null;
  let upgradeIO: IntersectionObserver | null = null;

  const cleanup = (removeFullEl = true) => {
    listeners.forEach((off) => off());
    listeners.length = 0;
    if (upgradeTimer) {
      clearTimeout(upgradeTimer);
      upgradeTimer = null;
    }
    if (upgradeIO) {
      upgradeIO.disconnect();
      upgradeIO = null;
    }
    if (releaseSlot) {
      releaseSlot();
      releaseSlot = null;
    }
    if (removeFullEl && fullEl) {
      try {
        fullEl.pause();
        fullEl.removeAttribute('src');
        fullEl.load();
        fullEl.remove();
      } catch {
        /* swallow */
      }
      fullEl = null;
    }
  };

  const addListener = (
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  const shouldSkip = (): boolean => {
    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (!conn) return false;
    if (conn.saveData) return true;
    if (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g') return true;
    return false;
  };

  const startUpgrade = async (): Promise<void> => {
    if (upgraded || fullEl || disposed) return;

    releaseSlot = await upgradeService.acquire();
    if (disposed) {
      releaseSlot();
      releaseSlot = null;
      return;
    }

    const full = document.createElement('video');
    full.muted = preview.muted;
    full.playsInline = preview.playsInline;
    full.loop = preview.loop;
    full.preload = 'auto';
    full.style.position = 'absolute';
    full.style.top = '0';
    full.style.left = '0';
    full.style.width = '100%';
    full.style.height = '100%';
    full.style.objectFit = getComputedStyle(preview).objectFit || 'cover';
    full.style.opacity = '0';
    full.style.transition = 'opacity 300ms ease';
    full.style.pointerEvents = 'none';
    fullEl = full;

    const parent = preview.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(full);
    }

    full.src = fullSrc;

    // Если юзер ушёл с табы — отменяем загрузку full.
    addListener(document, 'visibilitychange', () => {
      if (document.hidden && !upgraded) cleanup();
    });

    addListener(
      full,
      'canplaythrough',
      () => {
        if (!fullEl || upgraded || disposed) return;
        performSwap();
      },
      { once: true },
    );

    addListener(
      full,
      'error',
      () => cleanup(),
      { once: true },
    );

    // Sanity-timeout 30s — не висим вечно на тормозном CDN.
    upgradeTimer = setTimeout(() => {
      if (!upgraded) cleanup();
    }, 30_000);
  };

  const performSwap = (): void => {
    if (!fullEl) return;
    try {
      fullEl.currentTime = preview.currentTime % (fullEl.duration || preview.duration || 1);
    } catch {
      /* NaN duration — играем с 0 */
    }
    fullEl
      .play()
      .then(() => {
        if (!fullEl) return;
        fullEl.style.opacity = '1';
        setTimeout(() => {
          if (!preview.isConnected) return;
          try {
            preview.pause();
            preview.removeAttribute('src');
            preview.load();
            preview.style.display = 'none';
          } catch {
            /* swallow */
          }
        }, 320);
        upgraded = true;
        onUpgraded?.();
        // Слот освобождаем НЕ через cleanup, потому что full остаётся
        // живым в DOM. Просто отпускаем rate-slot.
        if (releaseSlot) {
          releaseSlot();
          releaseSlot = null;
        }
      })
      .catch(() => cleanup());
  };

  // Setup trigger
  const scheduleByTrigger = (): void => {
    switch (trigger) {
      case 'immediate':
        void startUpgrade();
        return;

      case 'onPlay-2s': {
        const onLoaded = (): void => {
          upgradeTimer = setTimeout(() => void startUpgrade(), 2000);
        };
        if (preview.readyState >= 2) {
          onLoaded();
        } else {
          addListener(preview, 'loadeddata', () => onLoaded(), { once: true });
        }
        return;
      }

      case 'onHover':
        if (matchMedia('(hover: none)').matches) return;
        addListener(preview, 'mouseenter', () => void startUpgrade(), { once: true });
        return;

      case 'onIntersect-50%':
        if (typeof IntersectionObserver === 'undefined') {
          void startUpgrade();
          return;
        }
        upgradeIO = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting && e.intersectionRatio >= 0.5) {
                upgradeIO?.disconnect();
                upgradeIO = null;
                void startUpgrade();
                return;
              }
            }
          },
          { threshold: [0.5] },
        );
        upgradeIO.observe(preview);
        return;

      case 'manual':
        return;
    }
  };

  if (!shouldSkip()) {
    scheduleByTrigger();
  }

  return {
    upgrade(): void {
      if (!upgraded && !fullEl) void startUpgrade();
    },
    dispose(): void {
      disposed = true;
      cleanup();
    },
  };
}
