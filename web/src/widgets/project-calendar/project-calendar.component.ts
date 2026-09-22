import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { CalendarDay, CalendarItem } from '@entities/publication/model/publication.types';
import {
  monthInWords,
  monthShort,
  monthStrip,
  neighbourMonths,
} from '@entities/publication/lib/calendar-months';
import { creatorLabel } from '@entities/publication/lib/publication-status';

/**
 * Кто снимает — портрет и адрес страницы, по user_id.
 *
 * В самой записи календаря этого нет: сервер отдаёт в дне только имя и
 * статус. Портреты и ссылки уже есть у страницы проекта (состав периода),
 * поэтому карта приходит сверху, а не догружается календарём.
 */
export interface CalendarPerson {
  name?: string;
  avatar_url?: string;
  /** routerLink на страницу специалиста; пусто — страница не опубликована. */
  link?: string[];
}

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
  imports: [CommonModule, NzIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-calendar.component.html',
  styleUrls: ['./project-calendar.component.scss', './project-calendar.component.touch.scss'],
})
export class ProjectCalendarComponent {
  // ГГГГ-ММ.
  public readonly month = input.required<string>();

  public readonly days = input<CalendarDay[]>([]);

  /**
   * Портреты по creator_user_id.
   *
   * Сетка без лиц отвечала только на «сколько», хотя вопрос к календарю —
   * «кто и когда снимает». Имя в клетку 40×40 не влезает, лицо влезает.
   */
  public readonly people = input<Record<string, CalendarPerson>>({});

  /**
   * Месяцы, в которых у проекта вообще есть выкладки.
   *
   * Без них пустая сетка — это ответ «в этом месяце ничего не стоит»,
   * неотличимый от «данные не доехали» и от «вы смотрите не туда». А
   * смотрели именно не туда: календарь открывался на текущем месяце, а
   * период проекта катится от первой публикации и на календарный месяц
   * не ложится — десять выкладок из одиннадцати оставались в соседнем
   * месяце, и ничто на это не намекало.
   */
  public readonly months = input<string[]>([]);

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

  /** В показанном месяце ничего не стоит и не выходило. */
  public readonly monthEmpty = computed(() =>
    this.cells().every((c) => c.blank || (!c.planned && !c.published)),
  );

  /** Ближайшие месяцы с выкладками — дорога из пустого месяца. */
  public readonly neighbours = computed(() => neighbourMonths(this.months(), this.month()));

  /** Выкладок нет во всём проекте: тогда и про соседние месяцы молчим. */
  public readonly projectEmpty = computed(
    () => this.monthEmpty() && !this.neighbours().before && !this.neighbours().after,
  );

  /**
   * Месяцы проекта под сеткой.
   *
   * Сетка показывает один месяц, и даже непустая она не отвечает на
   * вопрос «а это всё?». У проекта с одиннадцатью выкладками одна стояла
   * в сентябре, десять — в августе: сентябрь с единственной точкой
   * читался как «выкладок нет». Полоса показывает, где они есть, и
   * уводит туда в один клик.
   *
   * Из одного месяца полосы не бывает: там она сообщала бы только то,
   * что уже написано заголовком сетки.
   */
  public readonly strip = computed(() => {
    const all = monthStrip(this.months(), this.month());
    return all.length > 1 ? all : [];
  });

  /** Есть ли в этом месяце выкладки — для отметки в полосе. */
  public hasItems(month: string): boolean {
    return this.months().includes(month);
  }

  public short(month: string): string {
    return monthShort(month, this.month());
  }

  /** «в августе» — подпись месяца внутри фразы. */
  public inWords(month: string): string {
    return monthInWords(month, this.month());
  }

  public goMonth(month: string): void {
    this.selected.set(null);
    this.monthChange.emit(month);
  }

  public pick(cell: Cell): void {
    if (cell.blank || (!cell.planned && !cell.published)) return;
    this.selected.set(this.selected() === cell.date ? null : cell.date);
  }

  // Кто выходит в этот день. Имя приходит в самой записи календаря —
  // раньше показывать было нечего, кроме количества.
  public who(item: CalendarItem): string {
    return creatorLabel(item.creator_name);
  }

  /**
   * Лица дня без повторов: один человек с тремя роликами — одно лицо.
   * Больше трёх в клетку не помещается, остаток показываем числом.
   */
  public faces(cell: Cell): CalendarItem[] {
    const seen = new Set<string>();
    const out: CalendarItem[] = [];
    for (const i of cell.items) {
      if (seen.has(i.creator_user_id)) continue;
      seen.add(i.creator_user_id);
      out.push(i);
    }
    return out;
  }

  public facesShown(cell: Cell): CalendarItem[] {
    return this.faces(cell).slice(0, 3);
  }

  public facesRest(cell: Cell): number {
    return Math.max(0, this.faces(cell).length - 3);
  }

  public person(item: CalendarItem): CalendarPerson {
    return this.people()[item.creator_user_id] ?? {};
  }

  public avatarUrl(item: CalendarItem): string | undefined {
    return this.person(item).avatar_url;
  }

  public personLink(item: CalendarItem): string[] | null {
    return this.person(item).link ?? null;
  }

  public initial(item: CalendarItem): string {
    return (item.creator_name || '—').trim().charAt(0).toUpperCase();
  }

  public shift(delta: number): void {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    this.selected.set(null);
    this.monthChange.emit(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
}
