import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  RANGE_LABEL,
  RANGE_OF,
  RANGE_PREV,
  RANGE_TABS,
  formatDelta,
  initials,
  platformShares,
  windowCaption,
} from '@entities/billing/lib/overview';
import type {
  ClientOverview,
  OverviewRange,
  OverviewTopVideo,
} from '@entities/billing/model/billing.types';
import {
  PLATFORM_COLOR,
  PLATFORM_LABEL,
  PLATFORM_SHORT,
} from '@entities/publication/lib/publication-status';
import type { Platform } from '@entities/publication/model/publication.types';
import { formatAgo, plural } from '@shared/lib/format';
import type { SeriesPoint } from '@shared/lib/chart-series';
import { ErValueComponent } from '@shared/ui/er-value/er-value.component';
import { LineChartComponent } from '@shared/ui/line-chart/line-chart.component';

import { CountUpDirective } from './count-up.directive';

/**
 * Первый экран заказчика: что он получает за свои деньги.
 *
 * Прежняя сводка отвечала на вопрос бухгалтерии — сколько потрачено и
 * сколько стоит тысяча. Это правильные числа, но их показывают себе, а
 * не начальству. Здесь порядок обратный: сначала объём и откуда он,
 * потом отклик, потом доказательства — ролики, которые можно открыть и
 * проверить. Деньги никуда не делись, они ниже: их смотрят вторым
 * заходом.
 *
 * Всё, что здесь показано, посчитано ЗА ОКНО, и период стоит в подписи
 * под именем заказчика. Итоги за всё время — только в блоке про деньги,
 * и там они подписаны «по всем проектам»: оконное число рядом с общим
 * без подписи человек складывает в одно, и получается величина, которой
 * нет нигде.
 *
 * Слово «охват» не встречается ни разу, и это не придирка к словам: мы
 * считаем ПРОСМОТРЫ, а на различии «показ против просмотра» построена
 * вся коммерческая аргументация. Третье слово рядом её ломает.
 *
 * Компонент ничего не грузит и ничего не досчитывает: данные и окно ему
 * дают снаружи (их владелец — app-client-overview, он же ходит в сеть).
 * Так у экрана один запрос на всё, а не два одинаковых, и одно окно на
 * оба блока вместо двух расходящихся.
 */
@Component({
  selector: 'app-client-dashboard',
  standalone: true,
  imports: [CommonModule, ErValueComponent, LineChartComponent, CountUpDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-dashboard.component.html',
  styleUrl: './client-dashboard.component.scss',
})
export class ClientDashboardComponent {
  public readonly data = input<ClientOverview | null>(null);

  public readonly range = input<OverviewRange>('month');

  /** Имя заказчика для шапки. Уже загружено страницей — второй раз не тянем. */
  public readonly clientName = input('');

  public readonly rangeChange = output<OverviewRange>();

  public readonly tabs = RANGE_TABS;

  public readonly rangeLabel = RANGE_LABEL;

  /** «за месяц» — подпись при каждом оконном числе. */
  public readonly rangeOf = computed(() => RANGE_OF[this.range()]);

  /** «к прошлому месяцу» — с чем сравнивается прирост. */
  public readonly rangePrev = computed(() => RANGE_PREV[this.range()]);

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly platformColor = PLATFORM_COLOR;

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  public readonly who = computed(() => this.clientName().trim() || 'Ваши проекты');

  public readonly avatar = computed(() => initials(this.clientName()));

  public readonly caption = computed(() => windowCaption(this.range(), this.data()?.range_label));

  public pick(r: OverviewRange): void {
    if (r !== this.range()) this.rangeChange.emit(r);
  }

  // ---- герой ----
  //
  // Всё здесь — ЗА ОКНО. Заголовок и прирост рядом с ним обязаны
  // описывать одну величину: «3 млн просмотров, +34% к прошлому месяцу»
  // при числе за всё время читается как «за месяц 3 млн» и врёт даже
  // тогда, когда оба числа верны по отдельности.
  //
  // Итоги за всё время живут ниже, в блоке про деньги, и подписаны «по
  // всем проектам»: сложить их с оконными человек не должен даже
  // случайно.

  public readonly window = computed(() => this.data()?.window);

  public readonly views = computed(() => this.window()?.views ?? 0);

  public readonly viewsDelta = computed(() => formatDelta(this.window()?.views_delta_pct));

  /**
   * Состав просмотров по площадкам.
   *
   * Лучшее, что есть в этом экране: одна строка отвечает сразу на «сколько»
   * и «откуда», и именно её заказчик показывает у себя на совещании.
   */
  public readonly shares = computed(() =>
    platformShares(this.data()?.platforms, this.data()?.views.by_platform),
  );

  /** Есть ли что рисовать полосой: у проекта без роликов состава нет. */
  public readonly hasShares = computed(() => this.shares().some((s) => s.views > 0));

  // ---- отклик, тоже за окно ----

  public readonly commentsDelta = computed(() => formatDelta(this.window()?.comments_delta_pct));

  public readonly engagementDelta = computed(() =>
    formatDelta(this.window()?.engagement_delta_pct),
  );

  /** У ER прирост в ПУНКТАХ: «вырос на 7%» от 4,4% читается двояко. */
  public readonly erDelta = computed(() => formatDelta(this.window()?.er_delta_pp, 'pp'));

  // ---- площадки ----

  public deltaOf(pct: number | undefined) {
    return formatDelta(pct);
  }

  /**
   * Прироста нет ни у одной площадки.
   *
   * У нового проекта это обычное состояние: прошлого такого же окна ещё
   * не было, и сравнивать не с чем нигде. Сказать об этом надо один раз
   * на весь блок — пять одинаковых оговорок в пяти карточках подряд
   * читаются как сломанная вёрстка, а не как честность, и за ними
   * перестают видеть саму мысль.
   *
   * Когда прирост есть хотя бы у одной, общей оговорки нет: она была бы
   * неправдой. Там, где прироста нет, подвал карточки просто не рисуется
   * — пустое место честнее прочерка, который читается как ноль.
   */
  public readonly noPlatformDeltas = computed(
    () => this.hasShares() && !this.shares().some((s) => formatDelta(s.deltaPct).known),
  );

  /** Ряд мини-графика. Ноль остаётся нулём, пропущенного дня в ряду нет. */
  public seriesOf(points: readonly { date: string; views_gained: number }[]): SeriesPoint[] {
    return points.map((p) => ({ date: p.date, value: p.views_gained }));
  }

  // ---- залетевшие ролики ----
  //
  // Три карточки, не больше: это витрина, а не список. Ссылка на каждой
  // обязательна — весь смысл в том, что ролик можно открыть и проверить,
  // чего не умеет ни один рекламный отчёт.

  public readonly topVideos = computed(() => (this.data()?.top_videos ?? []).slice(0, 3));

  public platformOf(v: OverviewTopVideo): Platform {
    return v.platform as Platform;
  }

  /** Цвет площадки, разбавленный до фона плашки. */
  public tint(platform: string): string {
    return `${PLATFORM_COLOR[platform as Platform] ?? '#888'}22`;
  }

  // ---- свежесть ----

  public readonly collectedAt = computed(() => this.data()?.collected_at ?? '');

  public readonly collectedAgo = computed(() => {
    const at = this.collectedAt();
    return at ? formatAgo(at) : '';
  });
}
