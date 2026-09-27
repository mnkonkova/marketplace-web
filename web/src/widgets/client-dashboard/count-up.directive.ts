import { Directive, ElementRef, effect, inject, input } from '@angular/core';

import { groupDigits } from '@entities/billing/lib/money';

/**
 * Число, которое набирается на глазах.
 *
 * Единственное украшение на этом экране, и оно с работой: набор длится
 * меньше секунды и за это время успевает сказать «число живое, его
 * только что посчитали». Статичный миллион на первом экране читается как
 * картинка из презентации.
 *
 * Два правила, без которых это превращается в помеху:
 *
 *  • При включённом режиме уменьшенного движения анимации нет вовсе —
 *    сразу конечное число. Для части людей мелькание цифр это не
 *    «оживление», а тошнота и мигрень, и системная настройка ровно про
 *    это и говорит.
 *  • Разряды делятся тем же неразрывным пробелом, что и везде в
 *    продукте (groupDigits): число, которое по ходу набора выглядит
 *    иначе, чем в конце, дёргается на каждом кадре.
 *
 * Пишем прямо в textContent, минуя проверку изменений: шестьдесят циклов
 * обнаружения в секунду ради одной строки — это заметная цена.
 */
@Directive({
  selector: '[appCountUp]',
  standalone: true,
})
export class CountUpDirective {
  public readonly value = input.required<number>({ alias: 'appCountUp' });

  /** Хвост после числа: «%», « ₽». Внутрь анимации не попадает. */
  public readonly suffix = input('');

  private readonly el = inject(ElementRef<HTMLElement>);

  private frame = 0;

  public constructor() {
    effect(() => {
      const to = this.value();
      const suffix = this.suffix();
      // Кадры прошлого набора убиваем: при переключении окна их два, и
      // без отмены они дерутся за один и тот же textContent.
      cancelAnimationFrame(this.frame);

      if (!Number.isFinite(to) || this.reduced()) {
        this.print(to, suffix);
        return;
      }

      const DURATION = 850;
      const t0 = performance.now();
      const step = (now: number): void => {
        const p = Math.min(1, (now - t0) / DURATION);
        // Замедление к концу: у линейного набора последняя цифра
        // останавливается внезапно, и это читается как сбой.
        this.print(to * (1 - Math.pow(1 - p, 3)), suffix);
        if (p < 1) this.frame = requestAnimationFrame(step);
      };
      this.frame = requestAnimationFrame(step);
    });
  }

  private print(v: number, suffix: string): void {
    const n = Math.round(v);
    this.el.nativeElement.textContent = `${n < 0 ? '−' : ''}${groupDigits(n)}${suffix}`;
  }

  /** Системная настройка «меньше движения». */
  private reduced(): boolean {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }
}
