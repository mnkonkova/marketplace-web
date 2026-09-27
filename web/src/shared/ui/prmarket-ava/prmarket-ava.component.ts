import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Портрет человека в кабинетах «PrMarket».
 *
 * В макете аватарки рисуются генератором — там людей нет, и лицо надо
 * было откуда-то взять. У нас люди настоящие: если человек поставил
 * портрет, стоит портрет, а если нет — буквы имени на спокойном фоне.
 * Рисовать вымышленное лицо живому человеку нельзя: в составе проекта,
 * за который заказчик платит, это читается как чужой аккаунт.
 *
 * Цвет подложки выводится из имени, а не случайный: один и тот же
 * человек в плане, в календаре и в начислениях обязан быть одного
 * цвета — иначе взгляд не связывает три строки в одного человека.
 */
@Component({
  selector: 'app-prmarket-ava',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src()) {
      <img
        class="ava"
        [src]="src()"
        [alt]="name()"
        [style.width.px]="size()"
        [style.height.px]="size()"
      />
    } @else {
      <span
        class="ava letters"
        aria-hidden="true"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.font-size.px]="size() * 0.38"
        [style.background]="bg()"
        [style.color]="fg()"
        >{{ initials() }}</span
      >
      <span class="sr">{{ name() }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: none;
        // Подпись для скринридера лежит абсолютом. Без точки отсчёта
        // здесь она считается от страницы и встаёт там, где кружок
        // оказался в потоке, — внутри горизонтальной ленты это точка
        // далеко за правым краем экрана, и страница уезжала вбок
        // вслед за ней.
        position: relative;
      }

      .ava {
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        object-fit: cover;
      }

      .letters {
        font-weight: 700;
        letter-spacing: 0.01em;
        line-height: 1;
        user-select: none;
      }

      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
    `,
  ],
})
export class PrMarketAvaComponent {
  public readonly name = input('');

  public readonly src = input<string | undefined>(undefined);

  public readonly size = input(32);

  public readonly initials = computed(() => {
    const parts = this.name().trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  });

  private readonly hue = computed(() => {
    const s = this.name();
    let h = 7;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 99991;
    return h % 360;
  });

  public readonly bg = computed(() => `hsl(${this.hue()} 42% 88%)`);

  public readonly fg = computed(() => `hsl(${this.hue()} 45% 28%)`);
}
