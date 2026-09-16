import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  earnedTotal,
  periodHistory,
  type PeriodHistoryRow,
} from '@entities/billing/lib/creator-highlights';
import { shortViews } from '@entities/billing/lib/ladder';
import { formatMoney } from '@entities/billing/lib/money';
import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import { plural } from '@shared/lib/format';

/**
 * Трудовая биография креатора в этом проекте: период за периодом.
 *
 * Раньше это была строчка «Прошлые периоды» в боковой колонке — мелко,
 * бледно и одной суммой. Прошлый период это не архив: это единственное
 * место, где видно, что человек делает эту работу давно и что она
 * растёт. Поэтому здесь полный набор: сколько заработал, из чего
 * сложилось, сколько сняли за недосданное и как двигались просмотры.
 *
 * Вычет показываем ровно так же заметно, как заработок. Спрятать его
 * значит устроить человеку сюрприз в день выплаты.
 *
 * Идущий период сюда не попадает: он стоит выше, крупно и с прогнозом.
 * Второй такой же блок был бы не «подробнее», а той же суммой дважды на
 * одном экране.
 */
@Component({
  selector: 'app-creator-history',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-history.component.html',
  styleUrls: ['./creator-history.component.scss', './creator-history.component.touch.scss'],
})
export class CreatorHistoryComponent {
  public readonly earnings = input<CreatorEarnings | null>(null);

  /** Суммы приходят в копейках: на экран — рублями. */
  public readonly money = formatMoney;

  public readonly views = shortViews;

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  private readonly history = computed(() =>
    periodHistory(this.earnings()?.accruals, this.earnings()?.periods),
  );

  /** Только законченные периоды, свежие первыми. */
  public readonly rows = computed<PeriodHistoryRow[]>(() => this.history().filter((r) => !r.open));

  /**
   * Заработано за проект — сложением готовых сумм из начислений.
   *
   * Это не расчёт по тарифу: каждое слагаемое посчитал сервер, и
   * разойтись здесь нечему. Идущий период в сумму не входит — он ещё
   * вырастет, и «всего за проект» менялось бы каждый день.
   */
  public readonly earned = computed(() => earnedTotal(this.history()));
}
