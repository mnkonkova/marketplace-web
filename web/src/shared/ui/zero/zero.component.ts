import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * НОЛЬ — это факт, и набран он полным типографским весом.
 *
 * Правило продукта, у которого есть пара: `<app-nodata>` — «числа нет
 * вообще». Их путали, и путаница стоила дорого: 0 % у проекта, который
 * ещё не публиковался, и 100 % у закрытого носили один и тот же зелёный
 * бейдж. Читалось это как «оба в порядке», хотя в первом случае не
 * начато ничего.
 *
 * Поэтому ноль здесь выглядит ровно как 258 000: тот же кегль, тот же
 * цвет, та же плотность. Ноль сообщает измеренный результат — «платежей
 * не было ни одного», — и приглушать его значило бы прятать факт.
 *
 * Цветом ноль не красится никогда. Латунь значит «выросло», лёд —
 * «упало»; ноль не вырос и не упал, он просто ноль.
 */
@Component({
  selector: 'app-zero',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <b
      class="z"
      [class.num-m]="size() === 'm'"
      [class.num-l]="size() === 'l'"
      [class.num-s]="size() === 's'"
    >
      {{ value() }}
      @if (unit(); as u) {
        <span class="unit">{{ u }}</span>
      }
    </b>
    @if (note(); as n) {
      <span class="note">{{ n }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .z {
      display: block;
      color: var(--text, #f2f7f5);
      font-family: var(--font-head, 'Archivo', system-ui, sans-serif);
      font-variant-numeric: tabular-nums;
      font-weight: 800;
      letter-spacing: -0.035em;
      line-height: 0.94;
    }

    .num-l {
      font-size: clamp(34px, 3.8vw, 52px);
    }

    .num-m {
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }

    .num-s {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .unit {
      margin-left: 0.34em;
      color: var(--text-dim, #7e8d88);
      font: 600 0.34em/1 var(--font-body, 'Inter', system-ui, sans-serif);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    /* Что именно означает ноль. Без этой строки ноль честен, но нем:
       «0 ₽» и «платежей не было ни одного» — разной длины утверждения. */
    .note {
      display: block;
      margin-top: 6px;
      color: var(--text-dim, #7e8d88);
      font-size: 12.5px;
      line-height: 1.45;
    }
  `,
})
export class ZeroComponent {
  /**
   * Готовая строка числа. Форматирует вызывающая сторона: денежный ноль
   * пишется «0 ₽», счётный — «0», а долевой — «0 %», и знать об этом
   * должен тот, кто знает единицу.
   */
  public readonly value = input<string | number>(0);

  /** Единица отдельной мелкой пометкой: «₽», «из 5». Необязательна. */
  public readonly unit = input('');

  /** Что ноль означает. Одна короткая фраза, не абзац. */
  public readonly note = input('');

  public readonly size = input<'s' | 'm' | 'l'>('m');
}
