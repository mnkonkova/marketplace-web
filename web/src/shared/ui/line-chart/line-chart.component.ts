import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  PlacedPoint,
  SeriesPoint,
  labelledPoints,
  niceMax,
  placeAll,
  splitGaps,
} from '@shared/lib/chart-series';

/**
 * Один ряд на графике: чем он подписан, каким цветом и главный ли он.
 *
 * Цвет приходит снаружи, а не выбирается здесь, потому что он несёт
 * смысл: у площадок это их фирменный цвет, и такой же кружок стоит рядом
 * в составе просмотров. Своя палитра внутри графика развела бы одну и ту
 * же площадку в два цвета на одном экране.
 */
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: readonly SeriesPoint[];
  /**
   * Главная линия: толще остальных и рисуется поверх. Ровно одна на
   * график — это тот итог, который стоит числом над ним.
   */
  lead?: boolean;
}

/**
 * Поденный ряд линией. Один ряд или несколько на одной оси.
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
 *  • Несколько рядов делят ОДНУ ось времени (placeAll): у площадок
 *    разные дни первого замера, и разложенные каждый от своего начала
 *    линии встали бы со сдвигом друг относительно друга.
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
  //
  // Высота сжатого — тоже отсюда и в пикселях: место вызова уже сказало,
  // сколько отвести (`height`), и коробка обязана быть ровно такой.
  // Процентом её задать нельзя — карточка площадки своей высоты не
  // знает, и процент от неё превращается в ноль.
  host: {
    '[class.compact]': 'compact()',
    '[style.height.px]': 'compact() ? height() : null',
  },
})
export class LineChartComponent {
  public readonly points = input<readonly SeriesPoint[]>([]);

  /**
   * Несколько рядов сразу: разбор по площадкам плюс общая линия.
   *
   * Непустой `series` отменяет `points`: это два способа сказать одно и
   * то же, и складывать их вместе значило бы рисовать один ряд дважды.
   */
  public readonly series = input<readonly ChartSeries[]>([]);

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
   * Цвет единственной линии. Пусто — акцент темы.
   *
   * Задаётся только в карточке площадки, где цвет несёт смысл: он и есть
   * опознавательный знак площадки. У многорядного графика цвет каждой
   * линии приходит в самом ряду.
   */
  public readonly color = input('');

  /**
   * Легенда под шапкой: какая линия что означает.
   *
   * Рисует её сам график, а не место вызова: цвета линий живут здесь, и
   * вторая их копия рядом разошлась бы с первой на первой же правке. У
   * одного ряда легенды нет — подписывать нечего.
   */
  public readonly rows = computed<readonly ChartSeries[]>(() => {
    const many = this.series();
    if (many.length) return many;
    return [
      {
        key: 'single',
        label: this.yLabel(),
        color: this.color(),
        points: this.points(),
        lead: true,
      },
    ];
  });

  public readonly multi = computed(() => this.rows().length > 1);

  /**
   * Цвет узлов. У единственной линии он обязан совпадать с ней самой:
   * зелёные точки на красной линии читаются как второй ряд поверх
   * первого.
   */
  public readonly dotColor = computed(() => this.rows()[0]?.color || '');

  // Геометрия: слева место под подписи значений, снизу под даты. В сжатом
  // виде подписей нет — поля схлопываются до толщины самой линии, иначе
  // на тридцати пикселях высоты половину высоты занимало бы пустое поле.
  //
  // Ширина системы координат в сжатом виде другая. Пропорции viewBox мы
  // НЕ ломаем — растянутый плющит линию неравномерно, — а высоту задаёт
  // место вызова, значит ширина обязана быть ей соразмерна: 720×30 в
  // карточке шириной в четверть экрана дали бы линию в девять пикселей.
  public readonly W = computed(() => (this.compact() ? 220 : 720));

  /**
   * Слева ровно столько, сколько занимает самая широкая подпись.
   *
   * Фиксированных 54 единиц хватало на «250 000» и не хватало на
   * «5 000 000»: подпись рисуется от оси влево, а у svg здесь
   * overflow: visible — лишнее не обрезалось, а вылезало из карточки и
   * ложилось на её рамку. На широком экране это особенно заметно:
   * viewBox растягивается вместе с кеглем подписи.
   *
   * 6.3 — ширина знака моноширинного кегля 10.5 в единицах viewBox,
   * 10 — просвет между подписью и осью.
   */
  public readonly PL = computed(() => {
    if (this.compact()) return 2;
    const widest = this.yTicks().reduce(
      (n, t) => Math.max(n, t.value.toLocaleString('ru-RU').length),
      0,
    );
    return Math.max(54, Math.ceil(widest * 6.3) + 10);
  });

  public readonly PR = computed(() => (this.compact() ? 2 : 10));

  public readonly PT = computed(() => (this.compact() ? 3 : 12));

  public readonly PB = computed(() => (this.compact() ? 3 : 26));

  private readonly plotW = computed(() => this.W() - this.PL() - this.PR());

  private readonly plotH = computed(() => this.height() - this.PT() - this.PB());

  public readonly axisY = computed(() => this.height() - this.PB());

  /**
   * Все ряды, разложенные по ОБЩЕЙ оси времени.
   *
   * Общей — ключевое: ноль оси один на график, иначе площадка, начавшая
   * собираться на три дня раньше, рисовалась бы над чужими днями.
   */
  private readonly placedRows = computed(() => placeAll(this.rows().map((r) => r.points)));

  /** Ряд для случая одной линии — им пользуются размеры точек и подсказки. */
  public readonly placed = computed(() => this.placedRows()[0] ?? []);

  /** Все точки всех рядов: из них считается шкала и ось времени. */
  private readonly everyPoint = computed(() => this.placedRows().flat());

  /** Верх шкалы. Круглое число над максимумом ВСЕХ рядов. */
  public readonly scaleMax = computed(() => niceMax(this.everyPoint().map((p) => p.value)));

  /** Длина ряда в днях — знаменатель оси времени. */
  private readonly lastDay = computed(() =>
    this.everyPoint().reduce((m, p) => (p.day > m ? p.day : m), 0),
  );

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

  /**
   * Даты под осью — не чаще, чем влезает.
   *
   * Считаются по САМОМУ ДЛИННОМУ ряду, а не по первому: у площадки,
   * которая начала собираться позже, ось получилась бы короче общей, и
   * подписи разошлись бы с линиями.
   */
  public readonly xTicks = computed(() => {
    const longest = this.placedRows().reduce<PlacedPoint[]>(
      (best, run) => (run.length > best.length ? run : best),
      [],
    );
    return labelledPoints(longest).map((p) => ({ date: p.date, x: this.x(p.day) }));
  });

  /**
   * Куски линий: подряд идущие дни — один кусок, дыра — разрыв.
   *
   * Заливка считается по тому же куску и до оси: она показывает объём под
   * линией, а не под всем полем, — и в дыре её тоже быть не должно.
   * Рисуется она только у единственной линии: пять полупрозрачных
   * заливок друг поверх друга дают мутное пятно, из которого не читается
   * ни одна.
   */
  public readonly segments = computed(() => {
    const base = this.axisY();
    const rows = this.rows();
    const withArea = rows.length === 1;
    const out: {
      key: string;
      line: string;
      area: string;
      color: string;
      width: number;
      lead: boolean;
    }[] = [];
    this.placedRows().forEach((placed, i) => {
      const row = rows[i];
      for (const run of splitGaps(placed)) {
        if (run.length < 2) continue;
        const line = run
          .map((p) => `${this.x(p.day).toFixed(1)},${this.y(p.value).toFixed(1)}`)
          .join(' ');
        const from = this.x(run[0].day).toFixed(1);
        const to = this.x(run[run.length - 1].day).toFixed(1);
        out.push({
          key: `${row.key}:${run[0].date}`,
          line,
          area: withArea ? `M${from},${base} L${line.split(' ').join(' L')} L${to},${base} Z` : '',
          color: row.color,
          width: this.strokeWidth(row),
          lead: !!row.lead,
        });
      }
    });
    // Главная линия последней: в svg порядок рисования и есть порядок
    // наложения, и общая линия обязана лежать поверх разбора, а не
    // прятаться под ним в местах, где они сходятся.
    return out.sort((a, b) => Number(a.lead) - Number(b.lead));
  });

  /**
   * Толщина линии.
   *
   * Тонкая линия на светлой сетке читается как царапина: график смотрят
   * на просвет, с расстояния вытянутой руки, и главное в нём — форма, а
   * не точность попадания в пиксель. Разбор по площадкам тоньше общей
   * линии намеренно: так видно, что это слагаемые, а не пять равных
   * утверждений.
   */
  private strokeWidth(row: ChartSeries): number {
    if (this.compact()) return 2;
    if (!this.multi()) return 3;
    return row.lead ? 3.4 : 2;
  }

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
   *
   * У многорядного графика узлов нет вовсе: шесть цепочек кружков поверх
   * шести линий — это уже не график, а сыпь. Значения там читают по
   * наведению, где стоят сразу все ряды за день.
   */
  public readonly visibleDots = computed<
    { date: string; value: number; x: number; y: number; color: string }[]
  >(() => {
    // У многорядного графика цепочки узлов не рисуем — шесть линий с
    // кружками читаются как сыпь. Но ОДИНОЧНЫЙ замер показываем всегда,
    // и у КАЖДОГО ряда своим цветом: линии из одной точки не выходит, и
    // без узла такой день исчезает с графика — а если замер в проекте
    // пока один, то исчезает и весь график.
    if (this.multi()) {
      const rows = this.rows();
      const out: { date: string; value: number; x: number; y: number; color: string }[] = [];
      this.placedRows().forEach((placed, i) => {
        for (const run of splitGaps(placed)) {
          if (run.length !== 1) continue;
          const p = run[0];
          out.push({
            date: p.date,
            value: p.value,
            x: this.x(p.day),
            y: this.y(p.value),
            color: rows[i]?.color || '',
          });
        }
      });
      return out;
    }
    const mine = this.dots().map((d) => ({ ...d, color: this.dotColor() }));
    if (!this.compact()) return mine;
    const solo = new Set(
      splitGaps(this.placed())
        .filter((r) => r.length === 1)
        .map((r) => r[0].date),
    );
    return mine.filter((d) => solo.has(d.date));
  });

  /**
   * Радиус узла. На длинном ряде точки стоят через несколько пикселей, и
   * в обычном размере линия превращается в цепочку кружков.
   */
  public readonly dotRadius = computed(() => (this.placed().length > 40 ? 1.8 : 2.6));

  /**
   * Прозрачные колонки под наведение: попасть курсором в точку радиусом
   * два пикселя нельзя, а значение по наведению обещано.
   *
   * У многорядного графика в колонке стоят ВСЕ ряды этого дня: вопрос к
   * такому графику всегда «сколько в этот день дала каждая», а шесть
   * отдельных наводок на шесть линий в два пикселя толщиной — это не
   * ответ.
   */
  public readonly hits = computed(() => {
    const rows = this.rows();
    const placed = this.placedRows();
    // Дни, которые вообще есть хоть у одного ряда.
    const days = new Map<number, string>();
    placed.forEach((run) => run.forEach((p) => days.set(p.day, p.date)));
    const ordered = [...days.entries()].sort((a, b) => a[0] - b[0]);
    if (!ordered.length) return [];

    const w = ordered.length > 1 ? this.plotW() / (ordered.length - 1) : this.plotW();
    return ordered.map(([day, date]) => {
      const cx = this.x(day);
      const parts = placed
        .map((run, i) => {
          const hit = run.find((p) => p.day === day);
          if (!hit) return '';
          const name = rows[i].label;
          const num = `${this.sign()}${hit.value.toLocaleString('ru-RU')}`;
          return name ? `${name}: ${num}` : num;
        })
        .filter(Boolean);
      return {
        date,
        // Ряды в подсказке — сверху вниз, как в легенде. Перевод строки
        // <title> показывает как есть, и это единственная подсказка, на
        // которую можно рассчитывать без своего слоя поверх svg.
        text: parts.join('\n'),
        // Колонку режем по полю графика с обеих сторон. У ряда из двух
        // точек шаг равен всей ширине поля, и половина последней
        // колонки уезжала за край системы координат — а у svg здесь
        // overflow: visible, поэтому вместе с ней за край уезжала и
        // страница: на телефоне появлялась горизонтальная прокрутка.
        hx: ordered.length > 1 ? Math.max(this.PL(), cx - w / 2) : this.PL(),
        hw:
          ordered.length > 1
            ? Math.max(
                0,
                Math.min(this.PL() + this.plotW(), cx + w / 2) - Math.max(this.PL(), cx - w / 2),
              )
            : w,
      };
    });
  });

  /** Границы ряда — подпись «за какой это период». */
  public readonly span = computed(() => {
    const all = this.everyPoint();
    if (!all.length) return null;
    const sorted = [...all].sort((a, b) => a.day - b.day);
    return { from: sorted[0].date, to: sorted[sorted.length - 1].date };
  });
}
