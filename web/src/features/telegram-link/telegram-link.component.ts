import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzMessageService } from 'ng-zorro-antd/message';
import * as QRCode from 'qrcode';

import { TelegramApi } from '@entities/telegram/api/telegram.api';
import { TelegramLinkStore } from '@entities/telegram/model/telegram-link.store';
import { TelegramBot } from '@entities/telegram/model/telegram.types';
import { parseApiError } from '@shared/api/api-error';
import { isTelegramWebApp } from '@shared/lib/telegram-webapp';

/**
 * «Получать уведомления в Telegram» — кнопка в карточке проекта.
 *
 * Кнопкой, а не баннером и не рассылкой «подключите бота» (решение
 * владельца): баннер просят закрыть, рассылка раздражает, а здесь
 * человек уже смотрит на проект, по которому уведомления и придут.
 *
 * В списках проектов её нет: там нет предмета уведомления. В
 * мини-аппе её нет вовсе — человек уже в Telegram, привязка случилась
 * на входе.
 *
 * Гаснет сама, когда привязка появилась: спрашивать состояние у
 * сервера на каждой карточке незачем, TelegramLinkStore держит один
 * ответ на вкладку.
 */
@Component({
  selector: 'app-telegram-link',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <div class="tg-link">
        @if (!start()) {
          <button type="button" class="btn sm" [disabled]="busy()" (click)="connect()">
            {{ blocked() ? 'Вернуть уведомления в Telegram' : 'Получать уведомления в Telegram' }}
          </button>
          <span class="muted small">
            {{
              blocked()
                ? 'Бот заблокирован — нажмите «Запустить» в нём, и сообщения вернутся.'
                : 'Сроки и решения по проекту придут в бот. Работа остаётся в кабинете.'
            }}
          </span>
        } @else {
          <div class="tg-start">
            <a class="btn sm primary" [href]="start()!.url" target="_blank" rel="noopener">
              Открыть Telegram
            </a>
            <span class="muted small">
              Ссылка одноразовая и живёт пятнадцать минут. С телефона — по QR.
            </span>
            <canvas #qr class="qr" width="180" height="180"></canvas>
            <button type="button" class="btn sm quiet" (click)="done()">Готово</button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .tg-link {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .tg-start {
        display: grid;
        gap: 8px;
        justify-items: start;
      }

      .qr {
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #fff;
      }

      .small {
        font-size: 12px;
        line-height: 1.4;
      }
    `,
  ],
})
export class TelegramLinkComponent {
  private readonly api = inject(TelegramApi);

  private readonly store = inject(TelegramLinkStore);

  private readonly msg = inject(NzMessageService);

  /** Какой бот: креаторский в кабинете креатора, клиентский — у заказчика. */
  public readonly bot = input.required<TelegramBot>();

  public readonly busy = signal(false);

  public readonly start = signal<{ url: string } | null>(null);

  private readonly qrCanvas = viewChild<ElementRef<HTMLCanvasElement>>('qr');

  public constructor() {
    this.store.ensureLoaded();
    effect(() => {
      const s = this.start();
      if (!s) return;
      // Канвас появляется вместе с блоком — даём ангуляру тик.
      queueMicrotask(() => {
        const canvas = this.qrCanvas()?.nativeElement;
        if (!canvas) return;
        QRCode.toCanvas(canvas, s.url, { width: 180, margin: 1 }).catch(() => {});
      });
    });
  }

  public blocked(): boolean {
    return this.store.blocked(this.bot());
  }

  /**
   * Показывать ли кнопку.
   *
   * Внутри мини-аппа — никогда: человек уже в Telegram. Пока состояние
   * не загружено — тоже: мигнуть кнопкой и убрать её хуже, чем
   * показать на полсекунды позже.
   */
  public show(): boolean {
    if (isTelegramWebApp()) return false;
    if (!this.store.loaded()) return false;
    if (!this.store.available(this.bot())) return false;
    return !this.store.linked(this.bot());
  }

  public connect(): void {
    this.busy.set(true);
    this.api.linkCode(this.bot()).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.start.set({ url: res.url });
        // Открываем сразу: на телефоне это уводит прямо в бота, и
        // человеку не надо ничего переписывать. QR остаётся для тех,
        // кто сидит с десктопа.
        window.open(res.url, '_blank', 'noopener');
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось получить ссылку.').message);
      },
    });
  }

  /** «Готово»: перечитываем состояние — кнопка должна погаснуть сама. */
  public done(): void {
    this.start.set(null);
    this.store.reload();
  }
}
