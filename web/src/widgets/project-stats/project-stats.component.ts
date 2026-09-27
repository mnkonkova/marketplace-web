import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DayPoint, PublicationReport } from '@entities/publication/model/publication.types';
import {
  PLATFORM_COLOR,
  PLATFORM_LABEL,
  PLATFORM_SHORT,
} from '@entities/publication/lib/publication-status';
import { seriesTooShort } from '@shared/lib/chart-series';
import type { SeriesPoint } from '@shared/lib/chart-series';
import { plural } from '@shared/lib/format';
import { ErValueComponent } from '@shared/ui/er-value/er-value.component';
import { LineChartComponent } from '@shared/ui/line-chart/line-chart.component';
import { SotkaAvaComponent } from '@shared/ui/sotka-ava/sotka-ava.component';

// Цифры проекта: итоги, накопительный график по дням и разрез по
// площадкам. Один и тот же отчёт отдают три ручки (клиент, креатор,
// менеджер), поэтому блок общий — иначе «Просмотры по дням» появлялся бы
// на каждой странице своей вёрсткой.
//
// Ряд графика накопительный, и подписи обязаны это говорить: «за день»
// поверх накопительного ряда — не мелкая неточность, а другое число на
// порядок, которое читается как рекордный день.
//
// Глубина ряда (7 или 30 дней) — состояние самого виджета, а не входной
// параметр. Раньше это был вход `range`, и менять его было нечем нигде,
// кроме одного экрана менеджера: на остальных график всегда рисовал
// тридцать дней, а параметр стоял в коде и выглядел настройкой. Теперь
// переключатель едет вместе с виджетом и появляется везде, где он стоит,
// — а не там, где кто-то не забыл дорисовать кнопки.
@Component({
  selector: 'app-project-stats',
  standalone: true,
  imports: [CommonModule, ErValueComponent, LineChartComponent, SotkaAvaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-stats.component.html',
  styleUrls: ['./project-stats.component.scss', './project-stats.component.touch.scss'],
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
   * Показывать ли разбор по креаторам.
   *
   * Менеджеру он нужен всегда: «какая площадка тянет» отвечает про
   * каналы, а решение «кого звать в следующий месяц» принимается по
   * людям. Заказчику эта же разбивка приезжает своим блоком «Команда
   * периода» — со счётом, а не только с просмотрами, — и второй копией
   * они разъехались бы на первой же правке.
   */
  public readonly showCreators = input(false);

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

  /**
   * Фирменные цвета площадок.
   *
   * Разбор ПО ПЛОЩАДКАМ, крашенный одной краской, заставляет читать
   * подписи, чтобы понять, где чья полоса. Площадку узнают по цвету
   * раньше, чем прочтут название, и это единственное место экрана, где
   * цвет несёт данные, а не настроение.
   */
  public readonly platformColor = PLATFORM_COLOR;

  /**
   * Глубина ряда. Тридцать дней по умолчанию: месяц — это период проекта,
   * и именно на нём видно, как ролик набирает после выхода.
   *
   * Выбор живёт только пока смотрят: в адрес не уезжает и не запоминается.
   * Настройка, которая переживает вкладку, требует объяснения, где её
   * потом отменить, — а здесь это один клик туда и обратно.
   */
  public readonly range = signal<7 | 30>(30);

  public setRange(days: 7 | 30): void {
    this.range.set(days);
  }

  /** Весь ряд, по возрастанию дат. Из него режется окно. */
  private readonly allDays = computed<DayPoint[]>(() => {
    const r = this.report();
    if (!r) return [];
    return [...r.by_day].sort((a, b) => a.date.localeCompare(b.date));
  });

  public readonly days = computed<DayPoint[]>(() => this.allDays().slice(-this.range()));

  /**
   * Ряда меньше, чем на неделю: обе кнопки нарисуют одно и то же.
   *
   * Прятать переключатель в этом случае нельзя — его тогда не найти
   * вовсе, и вопрос «а где 7 дней» останется. Но и промолчать нельзя:
   * кнопка, от которой ничего не меняется, читается как сломанная.
   * Поэтому говорим прямо, за сколько дней вообще есть числа.
   */
  public readonly shortSeries = computed(() => seriesTooShort(this.allDays().length));

  /** Сколько дней в ряду всего — для подписи рядом с переключателем. */
  public readonly seriesDays = computed(() => this.allDays().length);

  /**
   * Ряд для графика.
   *
   * Геометрию, разрывы и подсказки рисует общий app-line-chart — тот же,
   * что и в сводке заказчика. Своей копии здесь больше нет: два графика
   * про одно и то же расходятся на первой же правке, и объяснять
   * «почему тут не так, как там» приходится голосом.
   */
  public readonly chartPoints = computed<SeriesPoint[]>(() =>
    this.days().map((d) => ({ date: d.date, value: d.views })),
  );

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

  public readonly hasChart = computed(() => this.days().length >= 2);

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }
}
