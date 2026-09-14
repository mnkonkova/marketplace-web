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
  /**
   * Что делать с preview-элементом после успешного swap'a:
   * - 'replace' (default): полностью удаляем preview из DOM, full
   *   занимает его место с тем же className/data-атрибутами. Так
   *   все querySelector'ы родителя видят ОДНО видео — full. Подходит
   *   для случаев когда preview создан через document.createElement
   *   (как в widgets/feed-view).
   * - 'hide': оставляем preview в DOM (display:none, src снят),
   *   full добавлен как абсолютный sibling. Используется в Angular-
   *   директиве [appProgressiveVideo], где host-элемент управляется
   *   Angular'ом и удалять его руками нельзя.
   *
   * Баг которое лечит 'replace': без него pause/play/mute-логика
   * через querySelector('video') в фид-вью находит preview (первый
   * в DOM), full остаётся живым и продолжает играть со звуком при
   * скролле ленты.
   */
  cleanupStrategy?: 'replace' | 'hide';
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
  const {
    preview,
    fullSrc,
    upgradeService,
    trigger = 'onPlay-2s',
    cleanupStrategy = 'replace',
    onUpgraded,
  } = opts;

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
    // Копируем className СРАЗУ (а не только при finalizeSwap) — иначе
    // родительские глобальные селекторы вроде
    // document.querySelectorAll('.feed-video') пропускают full на время
    // между append и replaceChild. Конкретно: toggleMute() в feed-view
    // ищет .feed-video — без раннего копирования mute не доходит до
    // full и звук остаётся включённым у вновь созданного оригинала.
    if (cleanupStrategy === 'replace') {
      full.className = preview.className;
    }
    full.style.position = 'absolute';
    full.style.top = '0';
    full.style.left = '0';
    full.style.width = '100%';
    full.style.height = '100%';
    full.style.objectFit = getComputedStyle(preview).objectFit || 'cover';
    full.style.opacity = '0';
    full.style.pointerEvents = 'none';
    // transition ставим в performSwap прямо перед fade-in (180мс) —
    // чтобы первоначальный seek не триггерил случайный fade.
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
    // Защита: preview паузится в активной article (юзер скроллит дальше) —
    // не запускаем full. Cleanup отменит upgrade.
    if (preview.paused) {
      cleanup();
      return;
    }

    // Sync таймлайна: preview = `-ss 2 -t 8` (8 сек начиная со 2-й
    // секунды оригинала, в лупе). Без offset full будет на 2 сек раньше.
    const PREVIEW_OFFSET_SEC = 2;
    let targetTime = 0;
    try {
      const fullDur = fullEl.duration || 0;
      const previewDur = preview.duration || 8;
      const previewElapsed = (preview.currentTime || 0) % previewDur;
      targetTime = (PREVIEW_OFFSET_SEC + previewElapsed) % (fullDur || previewDur || 1);
    } catch {
      /* NaN duration */
    }

    // Hard cut стратегия (вместо cross-fade):
    //   1. Seek full на нужный момент при opacity:0
    //   2. Ждём `seeked` — кадр готов в video buffer
    //   3. Запускаем play()
    //   4. На СЛЕДУЮЩЕМ animation frame делаем opacity 1 + paint full
    //      (без transition — снап) + пауза preview под ним
    // Глаз видит только переход «низкое → высокое разрешение»,
    // никакого cross-fade двух видео одновременно.
    const reveal = (): void => {
      if (!fullEl || upgraded || disposed) return;
      fullEl.style.transition = 'none';
      fullEl.style.opacity = '1';
      void fullEl.offsetHeight; // force reflow
      try {
        preview.pause();
      } catch {
        /* swallow */
      }
      upgraded = true;
      onUpgraded?.();
      if (releaseSlot) {
        releaseSlot();
        releaseSlot = null;
      }
      setTimeout(() => {
        if (!fullEl || disposed) return;
        finalizeSwap();
      }, 50);
    };

    const calcTarget = (): number => {
      try {
        const fullDur = fullEl!.duration || 0;
        const previewDur = preview.duration || 8;
        const elapsed = (preview.currentTime || 0) % previewDur;
        return (PREVIEW_OFFSET_SEC + elapsed) % (fullDur || previewDur || 1);
      } catch {
        return 0;
      }
    };

    const playAndReveal = (): void => {
      if (!fullEl || upgraded || disposed) return;
      fullEl
        .play()
        .then(() => requestAnimationFrame(() => reveal()))
        .catch(() => cleanup());
    };

    // Двушаговый seek: первый seek даёт грубое приближение, во время
    // которого preview уехал на ~250-400мс вперёд (seek-delay). После
    // seeked пересчитываем target по АКТУАЛЬНОМУ preview.currentTime —
    // получаем точную позицию. Если разница маленькая (<0.1с) — играем
    // сразу. Иначе делаем второй seek и ждём.
    const initialTarget = calcTarget();
    fullEl.currentTime = initialTarget;

    const correctAndReveal = (): void => {
      if (!fullEl || upgraded || disposed) return;
      if (preview.paused) {
        cleanup();
        return;
      }
      const correctedTarget = calcTarget();
      const drift = Math.abs(fullEl.currentTime - correctedTarget);
      if (drift < 0.08) {
        // Достаточно близко — играем без второго seek.
        playAndReveal();
        return;
      }
      // Slip > 80мс — корректируем. Forward-slip (drift вперёд) лучше
      // backward, поэтому добавляем небольшой буфер (~50мс) на seek
      // delay второго round'a.
      fullEl.currentTime = correctedTarget + 0.05;
      const onSecondSeeked = (): void => playAndReveal();
      fullEl.addEventListener('seeked', onSecondSeeked, { once: true });
      // Safety — если seeked не пришёл за 400мс, всё равно играем.
      setTimeout(() => {
        if (!upgraded && fullEl) {
          fullEl.removeEventListener('seeked', onSecondSeeked);
          playAndReveal();
        }
      }, 400);
    };

    if (
      Math.abs(fullEl.currentTime - initialTarget) < 0.05 &&
      fullEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      correctAndReveal();
    } else {
      fullEl.addEventListener('seeked', correctAndReveal, { once: true });
      setTimeout(() => {
        if (!upgraded && fullEl) correctAndReveal();
      }, 800);
    }
  };

  /**
   * Финальный шаг swap'a: либо подменяем preview на full в DOM (replace),
   * либо просто скрываем preview (hide). В replace-режиме full получает
   * className/data-атрибуты preview'a и становится единственным video-
   * элементом в родителе. Это критично для родительских селекторов вида
   * querySelector('video') — иначе они находят preview (первого), full
   * остаётся неуправляемым (играет звук при скролле и т.п.).
   */
  const finalizeSwap = (): void => {
    if (!fullEl) return;
    const parent = preview.parentElement;

    if (cleanupStrategy === 'replace' && parent) {
      // Копируем className и data-* атрибуты preview'a на full, чтобы
      // селекторы родителя (.feed-video, [data-index] и т.п.) продолжали
      // находить видео после замены.
      fullEl.className = preview.className;
      for (const attr of Array.from(preview.attributes)) {
        if (attr.name.startsWith('data-') && !fullEl.hasAttribute(attr.name)) {
          fullEl.setAttribute(attr.name, attr.value);
        }
      }
      // Снимаем абсолютное позиционирование — full теперь занимает место
      // preview'a в нормальном потоке (или согласно собственным CSS-классам).
      fullEl.style.position = '';
      fullEl.style.top = '';
      fullEl.style.left = '';
      fullEl.style.width = '';
      fullEl.style.height = '';
      fullEl.style.opacity = '';
      fullEl.style.pointerEvents = '';
      try {
        parent.replaceChild(fullEl, preview);
      } catch {
        // Если preview уже удалён — full остаётся как абсолютный sibling.
      }
      return;
    }

    // 'hide' — preview остаётся в DOM (как host директивы), просто
    // выключаем его и оставляем full абсолютным sibling'ом.
    if (!preview.isConnected) return;
    try {
      preview.pause();
      preview.removeAttribute('src');
      preview.load();
      preview.style.display = 'none';
    } catch {
      /* swallow */
    }
  };

  // Setup trigger
  const scheduleByTrigger = (): void => {
    switch (trigger) {
      case 'immediate':
        void startUpgrade();
        return;

      case 'onPlay-2s': {
        // Слушаем РЕАЛЬНЫЙ `play` event preview'a, не loadeddata.
        // preload="auto" грузит данные у всех карточек фида, и если бы
        // мы триггерили по loadeddata — full.play() в performSwap
        // запускал бы звук на невидимых карточках тоже. С `play`
        // upgrade срабатывает только когда юзер реально смотрит карточку
        // (feed-view сам зовёт .play() для активной article'и).
        //
        // Таймер сбрасывается на `pause`, чтобы быстрый скролл-пик
        // (preview играл <2 сек) не триггерил загрузку 30МБ full зря.
        //
        // Если upgrade уже в полёте (fullEl создан, ждёт canplaythrough) —
        // отменяем его. Иначе после паузы preview юзер скроллит дальше,
        // потом canplaythrough фаерится, performSwap вызывает
        // fullEl.play() — и full начинает играть со звуком фоном.
        const onPlay = (): void => {
          if (upgradeTimer) clearTimeout(upgradeTimer);
          upgradeTimer = setTimeout(() => void startUpgrade(), 2000);
        };
        const onPause = (): void => {
          if (upgradeTimer) {
            clearTimeout(upgradeTimer);
            upgradeTimer = null;
          }
          // In-flight upgrade (fullEl создан, но swap ещё не выполнен) —
          // отменяем. После swap'a (upgraded=true) fullEl уже в DOM
          // и им управляет feed-view.activate() напрямую.
          if (fullEl && !upgraded) {
            cleanup();
          }
        };
        addListener(preview, 'play', () => onPlay());
        addListener(preview, 'pause', () => onPause());
        // Если preview уже играет к моменту вызова (редко, но бывает
        // при autoplay + memory-cached source) — запускаем отсчёт сразу.
        if (!preview.paused) onPlay();
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
