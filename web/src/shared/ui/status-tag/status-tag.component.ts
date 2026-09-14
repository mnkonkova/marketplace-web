import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Что значит цвет плашки.
 *
 * Цвет тут — не украшение, а второй способ прочитать строку, и читать его
 * надо одинаково на всех экранах CRM. До этого он значил разное: у
 * пользователей зелёным был «активен», у модерации — «одобрен», у воронок
 * — «включена», а жёлтым в одном месте «ждём вас», в другом «не подтвердил
 * почту». Список из десяти строк с четырьмя смыслами одного цвета
 * приходится читать словами — то есть цвет не работает вовсе.
 *
 * Значения:
 *   ok      — готово или одобрено, делать нечего;
 *   wait    — ждёт действия от нас, отсюда и заметность;
 *   neutral — нейтральное состояние, просто факт;
 *   blocked — заблокировано или отклонено.
 */
export type StatusTone = 'ok' | 'wait' | 'neutral' | 'blocked';

@Component({
  selector: 'app-status-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="st" [class]="'st-' + tone()"><ng-content /></span>`,
  styles: [
    `
      .st {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.16));
        border-radius: 7px;
        background: var(--bg-elevated);
        color: var(--text-muted);
        font-size: 11.5px;
        font-weight: 600;
        white-space: nowrap;
      }

      .st-ok {
        border-color: var(--ok-line);
        background: var(--ok-bg);
        color: var(--ok);
      }

      .st-wait {
        border-color: var(--warn-line);
        background: var(--warn-bg);
        color: var(--warn);
      }

      .st-blocked {
        border-color: var(--bad-line);
        background: var(--bad-bg);
        color: var(--bad);
      }
    `,
  ],
})
export class StatusTagComponent {
  public readonly tone = input<StatusTone>('neutral');
}
