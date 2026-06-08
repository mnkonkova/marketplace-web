import { Injectable } from '@angular/core';

/**
 * Глобальный rate-limiter для прогрессивной загрузки full-видео.
 * В фиде/featured может одновременно тикать 5-10 карточек —
 * запустить столько же параллельных загрузок по 30MB = убить сеть
 * пользователя. Лимит держит ≤ MAX_PARALLEL, остальные ждут в FIFO.
 *
 * См. docs/PROGRESSIVE_VIDEO_PLAYBACK.md §5.F.
 */
@Injectable({ providedIn: 'root' })
export class ProgressiveUpgradeService {
  private static readonly MAX_PARALLEL = 2;
  private active = 0;
  private queue: Array<() => void> = [];

  /**
   * Запросить слот для апгрейда. Резолвится сразу если есть свободный,
   * иначе встаёт в очередь. Возвращает функцию `release()` — вызови
   * её когда апгрейд завершён (success или fail), чтобы освободить
   * слот следующему в очереди.
   */
  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryRun = () => {
        if (this.active < ProgressiveUpgradeService.MAX_PARALLEL) {
          this.active++;
          resolve(() => this.release());
        } else {
          this.queue.push(tryRun);
        }
      };
      tryRun();
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}
