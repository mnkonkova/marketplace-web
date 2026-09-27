import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * НЕТ ДАННЫХ — числа нет вообще.
 *
 * Пара к `<app-zero>`. Ноль — измеренный факт; «нет данных» — отсутствие
 * измерения, и подменять одно другим нельзя ни в какую сторону. Прочерк
 * этого не различает: «—» одинаково ставили и там, где ноль, и там, где
 * не считали, — а читатель считал прочерк нулём.
 *
 * Поэтому здесь не пишется ни ноля, ни прочерка. На месте, где число
 * встанет, стоит пунктирный след его размера, и рядом — КОГДА оно
 * появится. След говорит «здесь будет число», срок — «ждать столько».
 * Вместе они отвечают на вопрос, на который прочерк не отвечал никак.
 *
 * Срок обязателен по смыслу, но не по типам: бывает «подтвердит
 * менеджер» — то есть срока нет, а причина есть. Пустой `when` рисует
 * только след: это честнее выдуманной даты.
 */
@Component({
  selector: 'app-nodata',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nd" [class.inline]="inline()">
      @if (label(); as l) {
        <span class="eyebrow">{{ l }}</span>
      }
      <span
        class="ghost"
        [style.width.px]="ghostWidth()"
        [style.height.px]="ghostHeight()"
        aria-hidden="true"
      ></span>
      @if (when(); as w) {
        <span class="when">{{ w }}</span>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    /* Рамки и штриховки вокруг следа нет, и это важно.
       Сначала блок был штрихованной коробкой со следом внутри — две
       пунктирные фигуры одна в другой. На карточке заработка это
       читалось не как «числа пока нет», а как не догрузившийся элемент:
       ровно то, ради чего блок и заводили, только наоборот. След сам по
       себе и есть знак отсутствия — обводить его второй раз незачем. */
    .nd {
      padding: 0;
    }

    .eyebrow {
      display: block;
      margin-bottom: 9px;
      color: var(--text-dim, #7e8d88);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    /* След ровно там и такого размера, каким встанет число. */
    .ghost {
      display: block;
      border: 1.5px dashed #2e3b38;
      border-radius: 6px;
    }

    .nd.inline .ghost {
      display: inline-block;
      vertical-align: middle;
    }

    .nd.inline .when {
      display: inline;
      margin: 0 0 0 8px;
    }

    /* Когда число появится. Это и есть содержание блока — след без
       срока сообщает только «пусто». */
    .when {
      display: block;
      margin-top: 8px;
      color: var(--text-dim, #7e8d88);
      font-size: 12.5px;
      line-height: 1.45;
    }
  `,
})
export class NodataComponent {
  /** Чего именно нет: «Период 1», «Переписка с менеджером». */
  public readonly label = input('');

  /** Когда число появится и почему его нет сейчас. */
  public readonly when = input('');

  /** Размер следа — под кегль числа, которое сюда встанет. */
  public readonly ghostWidth = input(168);

  public readonly ghostHeight = input(38);

  /** Внутри строки реестра: без рамки и подложки. */
  public readonly inline = input(false);
}
