import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzMessageService } from 'ng-zorro-antd/message';

import { OrderApi } from '@entities/order/api/order.api';
import { plural } from '@shared/lib/format';
import { parseApiError } from '@shared/api/api-error';

// Своя занятость по месяцам. Её видят клиенты, когда расставляют
// приоритет в заказе.
//
// Состояний три, а не два: GET возвращает ТОЛЬКО отмеченные месяцы —
// не отмеченный в выдачу не попадает вовсе, и показывать его свободным
// нельзя. «Не отмечал» и «свободен» — разные вещи.
@Component({
  selector: 'app-creator-availability',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-availability.component.html',
  styleUrls: [
    './creator-availability.component.scss',
    './creator-availability.component.touch.scss',
  ],
})
export class CreatorAvailabilityComponent {
  private readonly orders = inject(OrderApi);

  private readonly msg = inject(NzMessageService);

  public readonly marks = signal<Record<string, boolean>>({});

  public constructor() {
    this.load();
  }

  public readonly months = computed(() => {
    const out: { key: string; label: string }[] = [];
    const now = new Date();
    const names = [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ];
    for (let i = 0; i < 6; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({ key, label: names[d.getMonth()] });
    }
    return out;
  });

  /**
   * Сколько месяцев видно на телефоне до разворота.
   *
   * Три: ближайший месяц отмечают почти всегда, следующий — часто, а
   * дальше это уже планирование, за которым в кабинет не заходят. Шесть
   * строк по две кнопки на 390px — экран с лишним под второстепенным.
   * Прячет лишние строки только медиазапрос в тач-слое; на десктопе
   * карточка остаётся целиком.
   */
  public readonly visibleOnPhone = 3;

  public readonly folded = signal(true);

  public readonly hiddenCount = computed(() =>
    Math.max(0, this.months().length - this.visibleOnPhone),
  );

  public monthWord(): string {
    return plural(this.hiddenCount(), 'месяц', 'месяца', 'месяцев');
  }

  public toggleFold(): void {
    this.folded.set(!this.folded());
  }

  // null — месяц не отмечен. Третье состояние, а не «занят по умолчанию».
  public stateOf(month: string): boolean | null {
    const v = this.marks()[month];
    return v === undefined ? null : v;
  }

  public set(month: string, available: boolean): void {
    this.orders.setAvailability(month, available).subscribe({
      next: () => {
        this.marks.set({ ...this.marks(), [month]: available });
        this.msg.success(available ? 'Месяц отмечен свободным.' : 'Месяц отмечен занятым.');
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось сохранить занятость.').message),
    });
  }

  private load(): void {
    this.orders.myAvailability(12).subscribe({
      next: (r) => {
        const map: Record<string, boolean> = {};
        // month приходит как ГГГГ-ММ-01 или ГГГГ-ММ — сводим к ключу сетки.
        for (const a of r.items) map[a.month.slice(0, 7)] = a.is_available;
        this.marks.set(map);
      },
      error: () => this.marks.set({}),
    });
  }
}
