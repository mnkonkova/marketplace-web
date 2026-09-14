import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney } from '@entities/billing/lib/money';
import { shortViews } from '@entities/billing/lib/ladder';
import { periodTitle } from '@entities/billing/lib/period';
import type { ClientOverview, OverviewProject } from '@entities/billing/model/billing.types';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import { ALL_PLATFORMS, Platform } from '@entities/publication/model/publication.types';
import { plural } from '@shared/lib/format';

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
  imports: [CommonModule],
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
  // Ряд поденный и НЕ сглаживается: провал в нём — факт, а не шум.
  // Сглаженная кривая показывает «всё ровно растёт» там, где на самом
  // деле две недели ничего не выходило, и первый же вопрос заказчика
  // «а что было в конце сентября» остаётся без ответа.

  public readonly series = computed(() => this.data()?.series ?? []);

  public readonly hasChart = computed(() => this.series().some((p) => p.views_gained > 0));

  /** Геометрия в пикселях: растянутый viewBox плющит подписи оси. */
  public readonly W = 720;

  public readonly H = 150;

  public readonly PL = 54;

  public readonly PR = 10;

  public readonly PT = 10;

  public readonly PB = 24;

  /** Верх шкалы — круглое число над максимумом дня. */
  public readonly scaleMax = computed(() => {
    const max = this.series().reduce((m, p) => Math.max(m, p.views_gained), 0);
    if (max <= 0) return 1;
    const pow = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / (pow / 2)) * (pow / 2);
  });

  public readonly axisY = computed(() => this.H - this.PB);

  /**
   * Столбики, а не линия.
   *
   * Прирост за день — величина дискретная: линия между «вчера 40 тысяч»
   * и «сегодня ноль» рисует плавный спуск, которого не было, — просто в
   * этот день ничего не выходило.
   */
  public readonly bars = computed(() => {
    const pts = this.series();
    if (!pts.length) return [];
    const width = this.W - this.PL - this.PR;
    const slot = width / pts.length;
    const h = this.H - this.PT - this.PB;
    const max = this.scaleMax();
    return pts.map((p, i) => {
      // Минимум в пиксель у ненулевого дня: столбик в 0,3 пикселя не
      // рисуется вовсе, и день с просмотрами выглядит как пустой.
      const value = Math.max(0, p.views_gained);
      const height = value > 0 ? Math.max(1, (value / max) * h) : 0;
      return {
        date: p.date,
        views: value,
        x: this.PL + i * slot + slot * 0.15,
        width: Math.max(1, slot * 0.7),
        y: this.PT + h - height,
        height,
      };
    });
  });

  public readonly yTicks = computed(() => {
    const max = this.scaleMax();
    const h = this.H - this.PT - this.PB;
    return [0, 0.5, 1].map((f) => ({
      value: Math.round(max * f),
      y: this.PT + h - f * h,
    }));
  });

  /** Подписи дат: не чаще, чем влезает. */
  public readonly xTicks = computed(() => {
    const bars = this.bars();
    if (bars.length < 2) return [];
    const step = Math.max(1, Math.ceil(bars.length / 6));
    const out: { date: string; x: number }[] = [];
    for (let i = 0; i < bars.length; i += step) {
      out.push({ date: bars[i].date, x: bars[i].x + bars[i].width / 2 });
    }
    const last = bars[bars.length - 1];
    if (out[out.length - 1]?.date !== last.date) {
      out.push({ date: last.date, x: last.x + last.width / 2 });
    }
    return out;
  });

  /** Лучший день ряда — подпись под графиком. */
  public readonly bestDay = computed(() => {
    const pts = this.series();
    if (!pts.length) return null;
    return pts.reduce((best, p) => (p.views_gained > best.views_gained ? p : best), pts[0]);
  });
}
