import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { formatMoney } from '@entities/billing/lib/money';
import { LADDER_STEP } from '@entities/billing/lib/ladder';
import {
  RANGE_LABEL,
  RANGE_OF,
  RANGE_PREV,
  RANGE_TABS,
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
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import type { Platform } from '@entities/publication/model/publication.types';
import { formatAgo, plural } from '@shared/lib/format';
import { cumulativeSeries, sumSeries } from '@shared/lib/chart-series';
import type { SeriesPoint } from '@shared/lib/chart-series';
import { LineChartComponent } from '@shared/ui/line-chart/line-chart.component';
import type { ChartSeries } from '@shared/ui/line-chart/line-chart.component';
import { NodataComponent } from '@shared/ui/nodata/nodata.component';
import { StepsComponent } from '@shared/ui/steps/steps.component';
import { TariffLadderComponent } from '@widgets/tariff-ladder/tariff-ladder.component';

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
  imports: [
    CommonModule,
    LineChartComponent,
    NodataComponent,
    StepsComponent,
    TariffLadderComponent,
    CountUpDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-dashboard.component.html',
  styleUrls: ['./client-dashboard.component.scss', './client-dashboard.component.touch.scss'],
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

  public readonly money = formatMoney;

  /**
   * Цена тысячи просмотров — за ВСЁ ВРЕМЯ, в отличие от всего остального
   * в этом ряду. Приходит с сервера посчитанной из фактических сумм: у
   * разных проектов разные версии условий, и средняя ставка тарифа
   * соврала бы. Пусто, пока просмотров нет, — делить не на что.
   */
  public readonly costPer1000 = computed(() => this.data()?.cost_per_1000 ?? 0);

  /**
   * Цена тысячи крупно: число одним кеглем, единица — мелкой пометкой.
   *
   * Режем готовую строку formatMoney по неразрывному пробелу, а не
   * форматируем второй раз своими руками: правило «дробную часть только
   * когда она есть» живёт там, и вторая его копия здесь однажды
   * показала бы «56,00 ₽» рядом с «56 ₽».
   */
  private readonly costParts = computed(() => this.money(this.costPer1000()).split(' '));

  public readonly costHead = computed(() => this.costParts()[0] ?? '');

  public readonly costUnit = computed(() => this.costParts()[1] ?? '');

  /**
   * Тарифная лесенка: почему тысяча стоит столько, сколько показано.
   *
   * Приходит с сервера ПОСЧИТАННОЙ и только тогда, когда сходится с
   * ценой тысячи рядом. В браузере тариф не считаем никогда: вторая
   * реализация ступеней разошлась бы со счётом молча, и заметили бы это
   * в день оплаты.
   */
  public readonly tariff = computed(() => this.data()?.tariff ?? null);

  /** Шаг шкалы насечек. Тот же, что у креатора и у менеджера. */
  public readonly ladderStep = LADDER_STEP;

  /** Сколько площадок под один ролик. «5» числом в разметке — враньё на будущее. */
  public readonly platformsTotal = ALL_PLATFORMS.length;

  /** «30 ступеней» — подпись к насечкам, со склонением. */
  public readonly steps = computed(() => {
    const n = Math.floor(this.views() / LADDER_STEP);
    return `${n} ${plural(n, 'ступень', 'ступени', 'ступеней')}`;
  });

  /**
   * ER строкой: «3,3%».
   *
   * Звёздочки здесь нет намеренно — оговорка про репосты раскрыта
   * словами в той же строке. Сноска-звёздочка отправляла читателя искать
   * расшифровку, которой рядом не было.
   */
  public readonly erText = computed(() => {
    const p = this.window()?.er_percent;
    return p == null ? '' : `${p.toFixed(1).replace('.', ',')}%`;
  });

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  public readonly caption = computed(() => windowCaption(this.range(), this.data()?.range_label));

  /**
   * Заголовок блока с роликами.
   *
   * «Залетевшие ролики» обещали отбор из многих, а показывали всё, что
   * есть: у проекта с одним роликом «залетевшим» объявлялся
   * единственный. Слово должно обещать ровно то, что под ним лежит.
   */
  public readonly clipsTitle = computed(() =>
    this.topVideos().length === 1 ? 'Ролик, который это сделал' : 'Ролики, которые это сделали',
  );

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

  // ---- приростов на этом экране больше нет ----
  //
  // Было четыре плитки с прочерком «—» под каждым числом: у нового
  // проекта прошлого такого же окна ещё нет, и сравнивать не с чем
  // НИГДЕ. Прочерк при этом читается как ноль, то есть как «не выросло»,
  // — мы утверждали то, чего не знаем, в четырёх местах сразу. Пустого
  // слота под неизвестное число быть не должно вовсе: когда сравнивать
  // будет с чем, прирост вернётся туда, где он что-то значит, а не в
  // ряд одинаковых рамок.
  //
  // Разбор приростов (formatDelta) остался в entities/billing/lib —
  // он ещё нужен другим экранам.

  // ---- главный график: разбор по площадкам плюс общая ----
  //
  // НАКОПИТЕЛЬНЫЙ, и это не вкусовщина. Над графиком стоит итог за окно,
  // и линия обязана показывать ту же величину: поденный прирост
  // естественно затухает — ролик выстреливает и остывает, — и под
  // числом-итогом такая линия читается как падение самого итога. Именно
  // из-за этого график здесь раньше не рисовался вовсе: порог в неделю
  // прятал падающую линию на коротком ряде. Накопление приходит ровно в
  // то число, что стоит сверху, и прятать становится нечего.
  //
  // Площадки своими цветами — теми же, что у кружков в составе
  // просмотров строкой выше. Общая линия поверх и толще: она итог, а не
  // шестая площадка, и цвет у неё не брендовый, а цвет текста — это «всё
  // вместе», а не ещё одна площадка, которую забыли назвать.

  /** Есть ли из чего рисовать: хотя бы у одной площадки ряд из двух дней. */
  public readonly hasChart = computed(() => this.chartSeries().length > 0);

  /**
   * График роста на телефоне свёрнут.
   *
   * Он про «как набралось», а число над ним — про «сколько». Шесть
   * линий на 358 пикселях ширины без курсора не читаются: подсказку по
   * дню, ради которой график и держат, пальцем не вызвать. Четыреста
   * пикселей за это — слишком дорого, и сразу под ними идут площадки,
   * которые отвечают на тот же вопрос числами.
   *
   * Прячет только медиазапрос в тач-слое; на десктопе график открыт.
   */
  public readonly chartFolded = signal(true);

  public toggleChartFold(): void {
    this.chartFolded.set(!this.chartFolded());
  }

  public readonly chartSeries = computed<ChartSeries[]>(() => {
    // В разбор идут площадки, по которым есть хотя бы один замер.
    //
    // Раньше порог был «два дня», и в первые сутки проекта график
    // пропадал целиком — вместе с секцией, без единого слова почему.
    // Один замер линией не нарисуешь, но точкой нарисуешь: за неё
    // отвечает line-chart, который ставит узел одиночному дню.
    const rows = this.shares().filter((s) => s.series.length >= 1);
    if (!rows.length) return [];

    const gains = rows.map((s) => s.series.map((p) => ({ date: p.date, value: p.views_gained })));
    const platforms: ChartSeries[] = rows.map((s, i) => ({
      key: s.platform,
      label: PLATFORM_LABEL[s.platform],
      color: PLATFORM_COLOR[s.platform],
      points: cumulativeSeries(gains[i]),
    }));

    // Общая линия — сумма тех же слагаемых, а не второй ряд с сервера:
    // складываем поденный прирост площадок, который сервер и разложил.
    // Поэтому её правый конец в точности равен числу над графиком; ряд
    // за всё время (90 дней) там дал бы другую величину под тем же
    // заголовком.
    const total: ChartSeries = {
      key: 'all',
      label: 'Все площадки',
      color: 'var(--text)',
      points: cumulativeSeries(sumSeries(gains)),
      lead: true,
    };
    // Одна площадка — общая линия ляжет ровно на неё: вторая линия по
    // тем же точкам не добавляет ничего, кроме лишней строки в легенде.
    return platforms.length === 1 ? platforms : [...platforms, total];
  });

  /**
   * Лучший день окна — подпись под графиком.
   *
   * Считается по ПРИРОСТУ, а не по накоплению: у накопительной линии
   * «лучший день» всегда последний, и подпись превратилась бы в
   * бессмыслицу. Накопление отвечает на «сколько всего», прирост — на
   * «когда выстрелило»; на графике стоит первое, в подписи второе.
   */
  public readonly bestDay = computed<SeriesPoint | null>(() => {
    const daily = sumSeries(
      this.shares().map((s) => s.series.map((p) => ({ date: p.date, value: p.views_gained }))),
    );
    if (!daily.length) return null;
    return daily.reduce((best, p) => (p.value > best.value ? p : best), daily[0]);
  });

  // ---- залетевшие ролики ----
  //
  // Три карточки, не больше: это витрина, а не список. Ссылка на каждой
  // обязательна — весь смысл в том, что ролик можно открыть и проверить,
  // чего не умеет ни один рекламный отчёт.

  public readonly topVideos = computed(() => (this.data()?.top_videos ?? []).slice(0, 3));

  public platformOf(v: OverviewTopVideo): Platform {
    return v.platform as Platform;
  }

  /**
   * Что значит звёздочка у ER.
   *
   * Ноль репостов и «площадка их не отдала» — разные утверждения, и
   * подпись обязана их различать: по ER сравнивают роликов между собой.
   */
  public erHint(v: OverviewTopVideo): string {
    const base = 'Лайки, комментарии и репосты к просмотрам за период';
    return v.er_without_shares ? `${base}. Репосты площадка не отдала — их тут нет.` : base;
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
