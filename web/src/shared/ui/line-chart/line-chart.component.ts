import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  PlacedPoint,
  SeriesPoint,
  labelledPoints,
  niceMax,
  placeSeries,
  splitGaps,
} from '@shared/lib/chart-series';

/**
 * Поденный ряд линией.
 *
 * Один компонент на все графики «просмотры по дням»: в сводке заказчика
 * и в статистике проекта рисуется одно и то же и про одно и то же. Два
 * своих графика начали бы расходиться на первой же правке — у одного
 * появились бы подсказки, у другого подписи оси, и «почему тут не так,
 * как там» пришлось бы объяснять голосом.
 *
 * Что здесь решено раз и навсегда, потому что это не вкусовщина:
 *
 *  • ЛОМАНАЯ, а не сглаженная кривая. Сглаживание — это уже рисунок, а
 *    не факт: между двумя замерами кривая показывает значения, которых
 *    не было, и делает это убедительно.
 *  • Дыра в ряду РВЁТ линию. Пропущенный день и день с нулём — разные
 *    вещи: ноль мы измерили, а пропущенного не мерили вовсе. Линия через
 *    него — выдумка в обе стороны: по нулю соврёт провалом, по соседям —
 *    ровным ростом.
 *  • Позиция точки — по ДАТЕ, а не по порядковому номеру: две недели
 *    тишины обязаны выглядеть как две недели, а не как один шаг.
 *  • Подписи обеих осей и значение по наведению обязательны. Без них
 *    линия остаётся картинкой: «выросло» не отличить от «выросло вдвое».
 *
 * Рисуем в пикселях, а не в 0..100 с растянутым viewBox: растянутый
 * viewBox плющит текст подписей вместе с линией.
 */
@Component({
  selector: 'app-line-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './line-chart.component.html',
  styleUrl: './line-chart.component.scss',
  // Класс на хосте, чтобы стили сжатого вида жили рядом с остальными
  // стилями графика, а не расползались по местам вызова.
  host: { '[class.compact]': 'compact()' },
})
export class LineChartComponent {
  public readonly points = input<readonly SeriesPoint[]>([]);

  /** Чем подписан график для скринридера. */
  public readonly label = input('');

  /** Что меряет ось Y: «всего просмотров на дату», «просмотров за день». */
  public readonly yLabel = input('');

  /** Знак перед значением в подсказке: «+» у прироста, пусто у итога. */
  public readonly sign = input('');

  public readonly height = input(172);

  /**
   * Сжатый вид: одна линия без осей, сетки и подписей.
   *
   * Нужен карточкам площадок в дашборде, где на график отведено тридцать
   * пикселей высоты: подписи там всё равно нечитаемы, а ось и сетка
   * превращаются в серую кашу. Это НЕ второй график: правила остаются те
   * же — ломаная, разрыв на пропущенных днях, позиция по дате. Ровно
   * ради этого сжатый вид и живёт здесь, а не отдельным компонентом:
   * своя копия «нарисуй ряд мелко» разошлась бы с этими правилами в
   * первую же правку.
   *
   * Там, где график стоит один и на него смотрят, сжатым его включать
   * нельзя: без подписей «выросло» не отличить от «выросло вдвое».
   */
  public readonly compact = input(false);

  /**
   * Цвет линии. Пусто — акцент темы.
   *
   * Задаётся только в карточке площадки, где цвет несёт смысл: он и есть
   * опознавательный знак площадки. На обычном графике цвет один.
   */
  public readonly color = input('');

  // Геометрия: слева место под подписи значений, снизу под даты. В сжатом
  // виде подписей нет — поля схлопываются до толщины самой линии, иначе
  // на тридцати пикселях половину высоты занимало бы пустое поле.
  //
  // Ширина системы координат в сжатом виде другая. Пропорции viewBox мы
  // НЕ ломаем — растянутый плющит линию неравномерно, — а высоту задаёт
  // место вызова, значит ширина обязана быть ей соразмерна: 720×30 в
  // карточке шириной в четверть экрана дали бы линию в девять пикселей.
  public readonly W = computed(() => (this.compact() ? 220 : 720));

  public readonly PL = computed(() => (this.compact() ? 2 : 54));

  public readonly PR = computed(() => (this.compact() ? 2 : 10));

  public readonly PT = computed(() => (this.compact() ? 3 : 12));

  public readonly PB = computed(() => (this.compact() ? 3 : 26));

  private readonly plotW = computed(() => this.W() - this.PL() - this.PR());

  private readonly plotH = computed(() => this.height() - this.PT() - this.PB());

  public readonly axisY = computed(() => this.height() - this.PB());

  /** Ряд по возрастанию дат, с позицией каждой точки в днях от начала. */
  public readonly placed = computed(() => placeSeries(this.points()));

  /** Верх шкалы. Круглое число над максимумом ряда. */
  public readonly scaleMax = computed(() => niceMax(this.placed().map((p) => p.value)));

  /** Длина ряда в днях — знаменатель оси времени. */
  private readonly lastDay = computed(() => {
    const p = this.placed();
    return p.length ? p[p.length - 1].day : 0;
  });

  private x(day: number): number {
    const span = this.lastDay();
    // Одна точка: середина поля. У левого края она читалась бы как
    // начало ряда, которого нет.
    if (span <= 0) return this.PL() + this.plotW() / 2;
    return this.PL() + (day / span) * this.plotW();
  }

  private y(value: number): number {
    const h = this.plotH();
    return this.PT() + h - (Math.max(0, value) / this.scaleMax()) * h;
  }

  /** Горизонтальные линии сетки с подписями значений. */
  public readonly yTicks = computed(() => {
    const max = this.scaleMax();
    return [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      value: Math.round(max * f),
      y: this.y(max * f),
    }));
  });

  /** Даты под осью — не чаще, чем влезает. */
  public readonly xTicks = computed(() =>
    labelledPoints(this.placed()).map((p) => ({ date: p.date, x: this.x(p.day) })),
  );

  /**
   * Куски линии: подряд идущие дни — один кусок, дыра — разрыв.
   *
   * Заливка считается по тому же куску и до оси: она показывает объём под
   * линией, а не под всем полем, — и в дыре её тоже быть не должно.
   */
  private readonly runs = computed(() => splitGaps(this.placed()));

  public readonly segments = computed(() => {
    const base = this.axisY();
    return this.runs()
      .filter((run) => run.length > 1)
      .map((run) => {
        const line = run
          .map((p) => `${this.x(p.day).toFixed(1)},${this.y(p.value).toFixed(1)}`)
          .join(' ');
        const from = this.x(run[0].day).toFixed(1);
        const to = this.x(run[run.length - 1].day).toFixed(1);
        return {
          key: run[0].date,
          line,
          area: `M${from},${base} L${line.split(' ').join(' L')} L${to},${base} Z`,
        };
      });
  });

  /**
   * Узлы линии со значением для подсказки.
   *
   * Точка стоит и на одиночном замере, который ни с чем не соединён: без
   * неё день, оставшийся без соседей, пропал бы с графика совсем.
   */
  public readonly dots = computed(() =>
    this.placed().map((p: PlacedPoint) => ({
      date: p.date,
      value: p.value,
      x: this.x(p.day),
      y: this.y(p.value),
    })),
  );

  /**
   * Узлы, которые видно.
   *
   * В сжатом виде — только одиночные замеры: линии из них не выходит, и
   * без точки такой день пропал бы с графика совсем. Остальные узлы на
   * тридцати пикселях высоты сливаются в цепочку кружков и съедают саму
   * линию, ради которой график и стоит.
   */
  public readonly visibleDots = computed(() => {
    if (!this.compact()) return this.dots();
    const solo = new Set(
      this.runs()
        .filter((r) => r.length === 1)
        .map((r) => r[0].date),
    );
    return this.dots().filter((d) => solo.has(d.date));
  });

  /**
   * Радиус узла. На длинном ряде точки стоят через несколько пикселей, и
   * в обычном размере линия превращается в цепочку кружков.
   */
  public readonly dotRadius = computed(() => (this.placed().length > 40 ? 1.8 : 2.6));

  /**
   * Прозрачные колонки под наведение: попасть курсором в точку радиусом
   * два пикселя нельзя, а значение по наведению обещано.
   */
  public readonly hits = computed(() => {
    const dots = this.dots();
    if (dots.length < 2) return dots.map((d) => ({ ...d, hx: this.PL(), hw: this.plotW() }));
    const w = this.plotW() / (dots.length - 1);
    return dots.map((d) => ({
      ...d,
      hx: Math.max(this.PL(), d.x - w / 2),
      hw: w,
    }));
  });

  /** Границы ряда — подпись «за какой это период». */
  public readonly span = computed(() => {
    const p = this.placed();
    if (!p.length) return null;
    return { from: p[0].date, to: p[p.length - 1].date };
  });
}
