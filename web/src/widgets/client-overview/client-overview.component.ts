import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney } from '@entities/billing/lib/money';
import { shortViews } from '@entities/billing/lib/ladder';
import { periodTitle } from '@entities/billing/lib/period';
import type { ClientOverview, OverviewProject } from '@entities/billing/model/billing.types';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import { ALL_PLATFORMS, Platform } from '@entities/publication/model/publication.types';
import type { SeriesPoint } from '@shared/lib/chart-series';
import { plural } from '@shared/lib/format';
import { LineChartComponent } from '@shared/ui/line-chart/line-chart.component';

/**
 * Сводка заказчика по всем проектам сразу.
 *
 * До неё всё считалось внутри одного проекта, и заказчик с тремя
 * проектами складывал числа в уме или в табличке. Главный вопрос этого
 * экрана в проекте по отдельности не имеет ответа вовсе: «во сколько мне
 * обходится тысяча просмотров».
 *
 * Это число и стоит на экране главным. Оно падает по мере роста — и это
 * лучший аргумент, какой можно показать: не «мы сделали много роликов»,
 * а «каждая следующая тысяча дешевле предыдущей».
 *
 * Слово «охват» здесь не встречается ни разу, и это не придирка к
 * словам: мы считаем ПРОСМОТРЫ, а на различии «показ против просмотра»
 * построена вся коммерческая аргументация. Назвать одно другим — обещать
 * то, чего мы не собираем.
 *
 * Ничего не считаем сами: суммы, стоимость тысячи и ряд графика приходят
 * с сервера готовыми. Складывать их заново значило бы получить на двух
 * экранах два разных числа.
 */
@Component({
  selector: 'app-client-overview',
  standalone: true,
  imports: [CommonModule, LineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-overview.component.html',
  styleUrl: './client-overview.component.scss',
})
export class ClientOverviewComponent {
  private readonly api = inject(BillingApi);

  public readonly loading = signal(true);

  public readonly data = signal<ClientOverview | null>(null);

  /**
   * Не доехало — блока просто нет.
   *
   * Сводка стоит НАД проектами, и красная плашка поверх списка пугает
   * сильнее, чем помогает: сами проекты при этом открываются и работают.
   */
  public readonly failed = signal(false);

  public readonly money = formatMoney;

  public readonly views = shortViews;

  public readonly platformLabel = PLATFORM_LABEL;

  public constructor() {
    this.api.clientOverview().subscribe({
      next: (r) => {
        this.data.set(r);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  /** Показывать сводку есть смысл, только когда есть хоть один проект. */
  public readonly hasProjects = computed(() => (this.data()?.projects_total ?? 0) > 0);

  /**
   * Просмотры по площадкам — все пять всегда, включая нулевые.
   *
   * Пропавший столбик читается как сбой, а не как ноль: человек ищет,
   * куда делся TikTok, вместо того чтобы прочитать «на TikTok пока
   * ничего».
   */
  public readonly platforms = computed(() => {
    const d = this.data();
    const by = d?.views.by_platform ?? {};
    const max = Math.max(1, ...ALL_PLATFORMS.map((p) => by[p] ?? 0));
    return ALL_PLATFORMS.map((p: Platform) => ({
      platform: p,
      views: by[p] ?? 0,
      percent: Math.round(((by[p] ?? 0) / max) * 100),
    }));
  });

  /** Проекты: сначала те, где что-то происходит. */
  public readonly projects = computed(() =>
    [...(this.data()?.projects ?? [])].sort((a, b) => {
      if (a.state !== b.state) return a.state === 'running' ? -1 : 1;
      return b.views - a.views;
    }),
  );

  public periodOf(p: OverviewProject): string {
    return p.period ? periodTitle(p.period) : '';
  }

  // ---- график прироста ----
  //
  // ЛИНИЯ, а не столбики. Просмотры — величина непрерывная, и от графика
  // ждут формы роста; столбики читаются как набор независимых событий,
  // между которыми ничего не происходило.
  //
  // Ряд поденный и НЕ сглаживается: провал в нём — факт, а не шум.
  // Сглаженная кривая показывает «всё ровно растёт» там, где на самом
  // деле две недели ничего не выходило, и первый же вопрос заказчика
  // «а что было в конце сентября» остаётся без ответа.
  //
  // Геометрию, разрывы и подсказки считает общий app-line-chart: такой
  // же график стоит в статистике проекта, и второй своей копии здесь
  // быть не должно — они разошлись бы на первой же правке.

  public readonly series = computed(() => this.data()?.series ?? []);

  public readonly hasChart = computed(() => this.series().some((p) => p.views_gained > 0));

  /**
   * Ряд для графика.
   *
   * Ноль остаётся нулём: в этот день просмотров не прибавилось, и это
   * измеренное число, а не пустое место. А дня, которого в ряду нет, не
   * мерили вовсе — подставлять ему ноль нельзя, и линию там рвёт сам
   * график.
   */
  public readonly chartPoints = computed<SeriesPoint[]>(() =>
    this.series().map((p) => ({ date: p.date, value: p.views_gained })),
  );

  /** Лучший день ряда — подпись под графиком. */
  public readonly bestDay = computed(() => {
    const pts = this.series();
    if (!pts.length) return null;
    return pts.reduce((best, p) => (p.views_gained > best.views_gained ? p : best), pts[0]);
  });
}
