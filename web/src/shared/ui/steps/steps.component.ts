import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Лесенка — подпись продукта.
 *
 * Одна насечка 7×12 — это 9:16, родная форма вертикального ролика.
 * Одна насечка = 100 000 просмотров, и единица эта ОДНА во всех
 * кабинетах: заказчик, креатор и менеджер меряют одним и тем же.
 * Следующая, ещё не взятая ступень — пунктирная: она показывает, куда
 * идти, и отличает «взял сорок» от «взял сорок и на этом всё».
 *
 * Зачем вместо полосы прогресса. Полоса меряет долю внутри одной
 * ступени, и у креатора на сороковой ступени она показывала четыре
 * пикселя заливки — то есть «ты ничего не заработал». Насечки меряют
 * пройденное целиком: сорок штук видно с другого конца комнаты.
 *
 * Два режима, потому что считают в них разное, а рисуется одно:
 *  • [views] — просмотры делятся на шаг. Шкала креатора и заказчика.
 *  • [filled]/[total] — насечек ровно `total`, закрашено `filled`.
 *    Строка плана у менеджера: пять площадок, насечка = площадка со
 *    ссылкой. Сюда же годится всё, где шкала конечна.
 *
 * Шаг приходит параметром, а не берётся из entities/billing: shared —
 * нижний слой FSD и про тарифы не знает. Значение по умолчанию совпадает
 * с LADDER_STEP; расходиться им нельзя, поэтому вызывающая сторона,
 * у которой константа под рукой, передаёт её явно.
 */
@Component({
  selector: 'app-steps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rungs"
      [class.sm]="size() === 'sm'"
      [class.lg]="size() === 'lg'"
      role="img"
      [attr.aria-label]="label()"
    >
      @for (s of notches(); track $index) {
        <i [class.on]="s === 1" [class.next]="s === 2"></i>
      }
      @if (overflow(); as more) {
        <span class="more">+{{ more }}</span>
      }
    </div>
  `,
  styles: `
    /* ПРО ИМЯ КЛАССА. Не .steps: в общем словаре страниц проекта
       (shared/scss/_crm.scss) это имя уже занято — так называется
       пошаговый индикатор мастера, и он несёт margin-bottom: 26px.
       Правила оттуда матчат всё внутри .crm-page, включая содержимое
       чужих компонентов: лесенка получала лишние 26 px снизу, ячейка
       строки реестра растягивалась, и насечки со счётчиком «5/5»
       вставали в два этажа. Инкапсуляция стилей защищает наружу, но не
       внутрь; отсюда своё имя, которого в словаре нет.

       Хост — сам флекс-контейнер, а не просто блок.
       В строке реестра ячейку растягивает сетка, и насечки прилипали к
       её верху, пока счётчик «5/5» стоял посередине: строка выходила в
       два этажа. Центрируем содержимое внутри хоста — тогда высота
       ячейки перестаёт что-либо значить. line-height:0 убирает строчный
       бокс от переносов в шаблоне. */
    :host {
      display: flex;
      align-items: center;
      line-height: 0;
    }

    .rungs {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      gap: 2px;
      align-items: flex-end;
      min-width: 0;
      max-width: 100%;
    }

    /* 7×12 — это 9:16 с точностью до пикселя. Пропорция здесь не
       украшение: продукт делает вертикальные ролики, и шкала повторяет
       их кадр. */
    .rungs i {
      display: block;
      flex: none;
      width: 7px;
      height: 12px;
      border-radius: 1.5px;
      background: #25332f;
    }

    /* Взятая ступень — латунь: «выросло». */
    .rungs i.on {
      background: var(--brass, #f0b357);
    }

    /* Следующая, ещё не взятая: контур без заливки. Заливать её нельзя
       даже приглушённо — это обещание денег, которых ещё нет. */
    .rungs i.next {
      background: none;
      border: 1px dashed var(--brass, #f0b357);
      opacity: 0.62;
    }

    .rungs.lg i {
      width: 11px;
      height: 19px;
      border-radius: 2px;
    }

    .rungs.sm i {
      width: 5px;
      height: 9px;
    }

    /* Хвост длинной шкалы. Рисовать тысячу насечек незачем: после
       сотни глаз их уже не считает, а строка перестаёт помещаться. */
    .more {
      margin-left: 6px;
      color: var(--text-dim, #7e8d88);
      font-size: 11.5px;
      font-weight: 600;
      line-height: 12px;
    }
  `,
})
export class StepsComponent {
  /** Просмотры. Режим шкалы по просмотрам. */
  public readonly views = input<number | null>(null);

  /** Просмотров в одной насечке. По умолчанию — как LADDER_STEP. */
  public readonly step = input(100_000);

  /** Закрашено насечек. Режим конечной шкалы. */
  public readonly filled = input<number | null>(null);

  /** Всего насечек в конечной шкале. */
  public readonly total = input<number | null>(null);

  /**
   * Показывать ли пунктирную «следующую».
   *
   * В режиме просмотров — да: следующая ступень есть всегда. В конечной
   * шкале — нет: незакрытые площадки уже нарисованы пустыми насечками, и
   * шестая пунктирная означала бы шестую площадку, которой нет.
   */
  public readonly withNext = input(true);

  public readonly size = input<'sm' | 'md' | 'lg'>('md');

  /** Сколько насечек рисуем максимум. Дальше — «+N» строкой. */
  public readonly limit = input(120);

  /** 1 — взята, 2 — следующая пунктирная, 0 — пустая. */
  public readonly notches = computed<number[]>(() => {
    const cap = Math.max(1, this.limit());
    const total = this.total();
    if (total != null) {
      const done = Math.max(0, Math.min(total, Math.floor(this.filled() ?? 0)));
      const shown = Math.min(total, cap);
      return Array.from({ length: shown }, (_, i) => (i < done ? 1 : 0));
    }
    const done = this.takenSteps();
    const shown = Math.min(done, cap);
    const out: number[] = Array.from({ length: shown }, () => 1);
    if (this.withNext() && shown === done) out.push(2);
    return out;
  });

  /** Ступеней взято — только целые: половина ступени денег не приносит. */
  private readonly takenSteps = computed(() => {
    const step = this.step();
    if (step <= 0) return 0;
    return Math.max(0, Math.floor((this.views() ?? 0) / step));
  });

  /** Хвост, не поместившийся в предел. Ноль — строки нет вовсе. */
  public readonly overflow = computed(() => {
    const total = this.total() ?? this.takenSteps();
    const rest = total - Math.min(total, Math.max(1, this.limit()));
    return rest > 0 ? rest : 0;
  });

  /**
   * Подпись для тех, кто шкалу не видит. Насечки — картинка, и без неё
   * скринридер прочитал бы пустоту.
   */
  public readonly label = computed(() => {
    const total = this.total();
    if (total != null) return `${Math.floor(this.filled() ?? 0)} из ${total}`;
    return `${this.takenSteps()} ступеней взято`;
  });
}
