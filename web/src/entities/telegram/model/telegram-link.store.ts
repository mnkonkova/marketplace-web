import { Injectable, computed, inject, signal } from '@angular/core';

import { TelegramApi } from '../api/telegram.api';
import { TelegramBot, TelegramStatus } from './telegram.types';

/**
 * Привязки человека к ботам — один запрос на вкладку.
 *
 * Кнопка «Получать уведомления в Telegram» живёт в карточке проекта, и
 * карточек человек открывает много. Спрашивать сервер на каждой значит
 * слать один и тот же запрос десять раз за минуту ради ответа, который
 * меняется раз в жизни.
 */
@Injectable({ providedIn: 'root' })
export class TelegramLinkStore {
  private readonly api = inject(TelegramApi);

  private readonly status = signal<TelegramStatus | null>(null);

  private loading = false;

  /** Загрузить один раз. Повторные вызовы — бесплатны. */
  public ensureLoaded(): void {
    if (this.status() || this.loading) return;
    this.loading = true;
    this.api.status().subscribe({
      next: (s) => {
        this.status.set(s);
        this.loading = false;
      },
      // Молча: кнопка просто не появится. Отсутствие кнопки лучше
      // ошибки на экране, куда человек пришёл за другим.
      error: () => {
        this.status.set({ links: [], available: [] });
        this.loading = false;
      },
    });
  }

  /** Перечитать: после привязки кнопка обязана погаснуть сама. */
  public reload(): void {
    this.status.set(null);
    this.loading = false;
    this.ensureLoaded();
  }

  public readonly loaded = computed(() => this.status() !== null);

  /** Бот настроен на сервере — иначе подключать нечего. */
  public available(bot: TelegramBot): boolean {
    return (this.status()?.available ?? []).includes(bot);
  }

  /**
   * Живая привязка есть. Заблокированный бот живой привязкой НЕ
   * считается: человеку надо показать кнопку снова — он мог
   * заблокировать по ошибке.
   */
  public linked(bot: TelegramBot): boolean {
    return (this.status()?.links ?? []).some((l) => l.bot === bot && !l.blocked_at);
  }

  public blocked(bot: TelegramBot): boolean {
    return (this.status()?.links ?? []).some((l) => l.bot === bot && !!l.blocked_at);
  }
}
