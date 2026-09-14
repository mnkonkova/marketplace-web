import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Обёртка списка: загрузка / пусто / ошибка с «Повторить».
 *
 * Третьего состояния в админке не было вовсе. Ручка отвечала 500 или
 * рвалась связь — `items` оставался пустым массивом, и экран говорил
 * «ничего не нашлось». Разница важная: в первом случае чинить нечего,
 * достаточно нажать ещё раз, во втором — менять фильтры. Молчащий пустой
 * список отвечал на оба вопроса одинаково и неверно.
 *
 * Текст ошибки приходит готовым — из `parseApiError`: бэк CRM пишет
 * `message` по-русски и для человека, и своя формулировка поверх него
 * была бы хуже оригинала.
 */
@Component({
  selector: 'app-list-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <p class="ls-note" role="status">Загружаем…</p>
    } @else if (error()) {
      <div class="ls-fail" role="alert">
        <p class="ls-msg">{{ error() }}</p>
        <button type="button" class="ls-retry" (click)="retry.emit()">Повторить</button>
      </div>
    } @else if (empty()) {
      <p class="ls-note">{{ emptyText() }}</p>
    } @else {
      <ng-content />
    }
  `,
  styles: [
    `
      .ls-note {
        margin: 0;
        padding: 28px 4px;
        color: var(--text-muted);
        font-size: 14px;
      }

      .ls-fail {
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
        padding: 16px 18px;
        border: 1px solid rgb(255 100 112 / 32%);
        border-radius: var(--r-card, 16px);
        background: rgb(255 100 112 / 8%);
      }

      .ls-msg {
        flex: 1;
        min-width: 220px;
        margin: 0;
        color: var(--text);
        font-size: 14px;
      }

      .ls-retry {
        flex: 0 0 auto;
        min-height: 34px;
        padding: 0 14px;
        border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.16));
        border-radius: var(--r-btn, 11px);
        background: var(--bg-elevated);
        color: var(--text);
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 600;
        cursor: pointer;
      }

      .ls-retry:hover {
        border-color: var(--cta);
        color: var(--cta);
      }
    `,
  ],
})
export class ListStateComponent {
  public readonly loading = input(false);

  /** Готовый текст ошибки. Пусто — ошибки нет. */
  public readonly error = input<string | null>(null);

  public readonly empty = input(false);

  public readonly emptyText = input('Пока пусто.');

  public readonly retry = output<void>();
}
