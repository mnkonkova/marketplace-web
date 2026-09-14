import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { CalendarDay, CalendarItem } from '@entities/publication/model/publication.types';
import { creatorLabel } from '@entities/publication/lib/publication-status';

interface Cell {
  // Пустая ячейка-заполнитель до первого числа месяца.
  blank: boolean;
  date: string;
  day: number;
  planned: number;
  published: number;
  items: CalendarItem[];
}

// Календарь выкладок на месяц. Бэк отдаёт только дни, в которых что-то
// есть, поэтому сетку месяца строим здесь: пустые дни в ответе не
// приходят, а показать их надо.
@Component({
  selector: 'app-project-calendar',
  standalone: true,
  imports: [CommonModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-calendar.component.html',
  styleUrl: './project-calendar.component.scss',
})
export class ProjectCalendarComponent {
  // ГГГГ-ММ.
  public readonly month = input.required<string>();

  public readonly days = input<CalendarDay[]>([]);

  public readonly monthChange = output<string>();

  public readonly weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  public readonly selected = signal<string | null>(null);

  public readonly title = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
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
    return `${names[m - 1]} ${y}`;
  });

  public readonly cells = computed<Cell[]>(() => {
    const [y, m] = this.month().split('-').map(Number);
    const byDate = new Map<string, CalendarDay>();
    for (const d of this.days()) byDate.set(d.date.slice(0, 10), d);

    const first = new Date(Date.UTC(y, m - 1, 1));
    // getUTCDay: 0 — воскресенье. Неделя начинается с понедельника.
    const lead = (first.getUTCDay() + 6) % 7;
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const out: Cell[] = [];
    for (let i = 0; i < lead; i += 1) {
      out.push({ blank: true, date: '', day: 0, planned: 0, published: 0, items: [] });
    }
    for (let d = 1; d <= total; d += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const entry = byDate.get(key);
      out.push({
        blank: false,
        date: key,
        day: d,
        planned: entry?.planned ?? 0,
        published: entry?.published ?? 0,
        items: entry?.items ?? [],
      });
    }
    return out;
  });

  public readonly selectedCell = computed(
    () => this.cells().find((c) => !c.blank && c.date === this.selected()) ?? null,
  );

  public pick(cell: Cell): void {
    if (cell.blank || (!cell.planned && !cell.published)) return;
    this.selected.set(this.selected() === cell.date ? null : cell.date);
  }

  // Кто выходит в этот день. Имя приходит в самой записи календаря —
  // раньше показывать было нечего, кроме количества.
  public who(item: CalendarItem): string {
    return creatorLabel(item.creator_name);
  }

  public shift(delta: number): void {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    this.selected.set(null);
    this.monthChange.emit(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
}
