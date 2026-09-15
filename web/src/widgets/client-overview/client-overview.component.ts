import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney } from '@entities/billing/lib/money';
import { shortViews } from '@entities/billing/lib/ladder';
import { periodTitle } from '@entities/billing/lib/period';
import { parseRange } from '@entities/billing/lib/overview';
import type {
  ClientOverview,
  OverviewProject,
  OverviewRange,
} from '@entities/billing/model/billing.types';
import type { SeriesPoint } from '@shared/lib/chart-series';
import { plural } from '@shared/lib/format';
import { LineChartComponent } from '@shared/ui/line-chart/line-chart.component';
import { ClientDashboardComponent } from '@widgets/client-dashboard/client-dashboard.component';

/**
 * Сводка заказчика по всем проектам сразу.
 *
 * До неё всё считалось внутри одного проекта, и заказчик с тремя
 * проектами складывал числа в уме или в табличке. Главный вопрос этого
 * экрана в проекте по отдельности не имеет ответа вовсе: «во сколько мне
 * обходится тысяча просмотров».
 *
 * Экран разложен на два разговора, и они НЕ смешиваются:
 *
 *  • Сверху — дашборд за выбранное окно: сколько посмотрели, откуда и
 *    как откликнулись. Это то, что показывают начальству, и там у
 *    каждого числа в подписи стоит период.
 *  • Ниже — деньги и проекты за ВСЁ ВРЕМЯ: сколько стоит работа, сколько
 *    внесено и во сколько обходится тысяча. Эти числа не должны скакать
 *    при переключении окна — вопрос «сколько мне это стоило всего» от
 *    окна не зависит.
 *
 * Оконное число рядом с общим без подписи человек складывает в одно, и
 * получается величина, которой нет нигде, — поэтому подписи здесь не
 * украшение, а часть смысла.
 *
 * Слово «охват» не встречается ни разу, и это не придирка к словам: мы
 * считаем ПРОСМОТРЫ, а на различии «показ против просмотра» построена
 * вся коммерческая аргументация. Назвать одно другим — обещать то, чего
 * мы не собираем.
 *
 * Ничего не считаем сами: суммы, стоимость тысячи, доли и ряды приходят
 * с сервера готовыми. Складывать их заново значило бы получить на двух
 * экранах два разных числа.
 */
@Component({
  selector: 'app-client-overview',
  standalone: true,
  imports: [CommonModule, LineChartComponent, ClientDashboardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-overview.component.html',
  styleUrl: './client-overview.component.scss',
})
export class ClientOverviewComponent {
  private readonly api = inject(BillingApi);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly destroyRef = inject(DestroyRef);

  /** Имя заказчика для шапки дашборда. Страница его уже загрузила. */
  public readonly clientName = input('');

  public readonly loading = signal(true);

  public readonly data = signal<ClientOverview | null>(null);

  /**
   * Не доехало — блока просто нет.
   *
   * Сводка стоит НАД проектами, и красная плашка поверх списка пугает
   * сильнее, чем помогает: сами проекты при этом открываются и работают.
   */
  public readonly failed = signal(false);

  /**
   * Выбранное окно.
   *
   * Живёт в адресе, а не в памяти вкладки: этот экран показывают
   * начальству и на него дают ссылку, а ссылка на «квартал» обязана
   * открыться кварталом. Заодно работают «назад» и «вперёд» в браузере.
   */
  public readonly range = signal<OverviewRange>('month');

  public readonly money = formatMoney;

  public readonly views = shortViews;

  public constructor() {
    // Подписка, а не разовое чтение снимка: окно меняется навигацией, и
    // назад по истории обязано вернуть прошлое окно вместе с числами.
    this.route.queryParamMap
      .pipe(
        map((q) => parseRange(q.get('range'))),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.range.set(r);
        this.load(r);
      });
  }

  /** Переключение окна — это навигация: окно живёт в адресе. */
  public setRange(r: OverviewRange): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { range: r },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private load(r: OverviewRange): void {
    this.loading.set(true);
    this.api.clientOverview(r).subscribe({
      next: (resp) => {
        this.data.set(resp);
        this.failed.set(false);
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

  // ---- сравнение с рынком ----
  //
  // Стоит рядом с деньгами, а не под героем дашборда, потому что
  // считается от цены тысячи ЗА ВСЁ ВРЕМЯ: под оконным числом оно
  // сравнивало бы разные вещи.
  //
  // Источник и дата замера — не мелкий шрифт для юристов: цифра рынка
  // без них через год начнёт врать, а с ними её можно открыть и
  // проверить. Продаёт здесь именно проверяемость, а не размер разрыва.
  //
  // Блока может не быть вовсе: пока просмотров нет, своей цены тысячи у
  // нас тоже нет, и сравнение с пустым местом выглядело бы подтасовкой.

  public readonly market = computed(() => this.data()?.market ?? []);

  public readonly hasMarket = computed(
    () => !!this.data()?.cost_per_1000 && this.market().length > 0,
  );

  /** «в 17,8 раза» — дробь с запятой, как во всех русских числах. */
  public times(n: number): string {
    return n.toFixed(1).replace('.', ',').replace(/,0$/, '');
  }

  /**
   * Слово после кратности. У дробного всегда «раза» («в 17,8 раза»), у
   * целого — по общему правилу: «в 2 раза», но «в 5 раз».
   */
  public timesWord(n: number): string {
    return Number.isInteger(n) ? plural(n, 'раз', 'раза', 'раз') : 'раза';
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
