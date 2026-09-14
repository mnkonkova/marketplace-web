import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DayPoint, PublicationReport } from '@entities/publication/model/publication.types';
import { PLATFORM_LABEL, PLATFORM_SHORT } from '@entities/publication/lib/publication-status';
import { plural } from '@shared/lib/format';
import { ErValueComponent } from '@shared/ui/er-value/er-value.component';

// Цифры проекта: итоги, накопительный график по дням и разрез по
// площадкам. Один и тот же отчёт отдают три ручки (клиент, креатор,
// менеджер), поэтому блок общий — иначе «Просмотры по дням» появлялся бы
// на каждой странице своей вёрсткой.
//
// Ряд графика накопительный, и подписи обязаны это говорить: «за день»
// поверх накопительного ряда — не мелкая неточность, а другое число на
// порядок, которое читается как рекордный день.
@Component({
  selector: 'app-project-stats',
  standalone: true,
  imports: [CommonModule, ErValueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-stats.component.html',
  styleUrl: './project-stats.component.scss',
})
export class ProjectStatsComponent {
  public readonly report = input<PublicationReport | null>(null);

  // Показ статистики выключен в настройках проекта: бэк отвечает 404 и
  // на отчёт, и на цифры в ленте. Это не ошибка загрузки — так и пишем.
  public readonly denied = input(false);

  // Проект закрыт, подробные строки удалены (410 collapsed_no_detail).
  public readonly collapsed = input(false);

  public readonly showPlatforms = input(true);

  /**
   * Показывать плитки с итогами.
   *
   * На клиентской странице проекта они стоят отдельным рядом наверху, и
   * второй такой же ряд внутри блока статистики — не «подробнее», а
   * дубль: одни и те же четыре числа дважды на одном экране.
   */
  public readonly showKpis = input(true);

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly range = input<7 | 30>(30);

  public readonly days = computed<DayPoint[]>(() => {
    const r = this.report();
    if (!r) return [];
    const all = [...r.by_day].sort((a, b) => a.date.localeCompare(b.date));
    return all.slice(-this.range());
  });

  // Геометрия графика — из макета: слева место под подписи оси, снизу
  // под даты. Рисуем в пикселях, а не в 0..100 с растянутым viewBox:
  // растянутый viewBox плющит текст подписей вместе с линией.
  public readonly W = 720;

  public readonly H = 172;

  public readonly PL = 52;

  public readonly PR = 10;

  public readonly PT = 12;

  public readonly PB = 26;

  /**
   * Верх шкалы — «круглое» число над максимумом дня.
   *
   * Без округления верхняя подпись оси повторяла максимум («3 000 000»),
   * и шкала читалась как «до сих пор», а не «до столько-то».
   */
  public readonly scaleMax = computed(() => {
    const max = this.days().reduce((m, d) => Math.max(m, d.views), 0);
    if (max <= 0) return 1;
    const pow = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / (pow / 2)) * (pow / 2);
  });

  /**
   * Последняя точка ряда — она же итог на сегодня.
   *
   * Ряд `by_day` НАКОПИТЕЛЬНЫЙ: снимок за день — это «всего просмотров на
   * эту дату» (см. viewsByDay в internal/publications/report.go), поэтому
   * «максимум за день» здесь совпадал с итогом проекта и спорил с
   * плиткой «+1 000 000 за сутки»: на графике выходило, что за один день
   * набралось всё. Подпись приведена к тому, что в данных на самом деле.
   */
  public readonly lastPoint = computed<DayPoint | null>(() => {
    const d = this.days();
    return d.length ? d[d.length - 1] : null;
  });

  private x(i: number): number {
    const n = this.days().length;
    if (n < 2) return this.PL;
    return this.PL + (i / (n - 1)) * (this.W - this.PL - this.PR);
  }

  private y(v: number): number {
    const h = this.H - this.PT - this.PB;
    return this.PT + h - (v / this.scaleMax()) * h;
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
   * Подписи дат: не чаще, чем влезает. Тридцать дат подряд сливаются в
   * серую полосу, из которой не прочесть ни одной.
   */
  public readonly xTicks = computed(() => {
    const d = this.days();
    if (d.length < 2) return [];
    const step = Math.max(1, Math.ceil(d.length / 6));
    const out: { date: string; x: number }[] = [];
    for (let i = 0; i < d.length; i += step) out.push({ date: d[i].date, x: this.x(i) });
    const last = d.length - 1;
    if (out[out.length - 1]?.date !== d[last].date) {
      out.push({ date: d[last].date, x: this.x(last) });
    }
    return out;
  });

  public readonly axisY = computed(() => this.H - this.PB);

  // Полилиния графика в координатах самого svg.
  public readonly polyline = computed(() => {
    const pts = this.days();
    if (pts.length < 2) return '';
    return pts.map((p, i) => `${this.x(i).toFixed(1)},${this.y(p.views).toFixed(1)}`).join(' ');
  });

  /** Та же линия, замкнутая на ось — заливка под кривой. */
  public readonly area = computed(() => {
    const line = this.polyline();
    if (!line) return '';
    const base = this.axisY();
    return `M${this.PL},${base} L${line.split(' ').join(' L')} L${this.x(this.days().length - 1)},${base} Z`;
  });

  public readonly hasChart = computed(() => this.days().length >= 2);

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }
}
