import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * Вовлечённость одним числом: (лайки + комментарии + репосты) ÷ просмотры.
 *
 * Репосты отдают не все площадки, и там, где их нет, число посчитано без
 * них — то есть занижено. Про это обязана говорить сама цифра, а не
 * сноска внизу экрана: ER сравнивают между роликами и площадками, и
 * сравнивать «с репостами» с «без репостов» молча нельзя. Отсюда
 * звёздочка с пояснением по наведению.
 *
 * Звёздочка будет стоять сразу у всех, пока сборщик не пройдёт первый раз
 * и не заполнит колонку репостов, — это не поломка вёрстки. Прятать её на
 * этом основании нельзя: «у всех занижено» — такой же факт, как «у одного
 * занижено», и именно в этот момент он важнее всего.
 *
 * Отдельный компонент, потому что мест показа пять — отчёт менеджера,
 * лента заказчика, разбор по площадкам, плитка проекта и карточка ролика
 * у креатора, — и пять копий этого правила разошлись бы в первую же
 * правку.
 */
@Component({
  selector: 'app-er-value',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // inline-flex: пробелы между элементами внутри флекс-контейнера не
  // рендерятся, и звёздочка встаёт вплотную к проценту независимо от того,
  // как шаблон переносит строки.
  template: `
    @if (percent() == null) {
      <span class="dash">—</span>
    } @else {
      <span class="num">{{ percent() | number: '1.0-1' }}%</span>
      @if (withoutShares()) {
        <abbr class="star" [title]="hint">*</abbr>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: baseline;
    }

    .star {
      border: none;
      color: var(--muted, #8c94a0);
      cursor: help;
      text-decoration: none;
    }
  `,
})
export class ErValueComponent {
  /** Пусто — делить не на что: просмотров нет, и ER не существует. */
  public readonly percent = input<number | null | undefined>(null);

  /** Хоть одна площадка, вошедшая в расчёт, репостов не отдала. */
  public readonly withoutShares = input(false);

  public readonly hint =
    'Посчитано без репостов: площадка их не отдаёт. Настоящая вовлечённость выше.';
}
