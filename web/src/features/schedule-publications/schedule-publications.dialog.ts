import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { BatchRequest } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';

export interface ScheduleCreator {
  user_id: string;
  display_name: string;
}

export interface SchedulePublicationsData {
  projectID: string;
  creators: ScheduleCreator[];
  // У проекта включён этап согласования черновика: тогда имеет смысл
  // спрашивать, за сколько дней до выкладки сдавать черновик.
  draftRequired: boolean;
}

/** Заготовки расписания: то, чем реально пользуются. */
type Preset = 'tue_thu' | 'mon_wed_fri' | 'every2' | 'clear';

const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** ГГГГ-ММ-ДД в локальном времени: toISOString сдвигает дату на UTC. */
function key(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Массовая простановка дат выкладок.
 *
 * Тридцать штук по одной завести нельзя, поэтому единственный путь —
 * пачка. Даты выбираются календарём поимённо, а не диапазоном со схемой:
 * заготовки («Вт и Чт») ставят галочки, а дальше их правят руками —
 * праздники и съёмочные дни в схему не укладываются.
 *
 * Разметка перенесена из макета ~/tmp/crm_project_manager (1).html.
 */
@Component({
  selector: 'app-schedule-publications-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="crm-page form" (submit)="$event.preventDefault(); create()">
      <p class="lbl">Кому</p>
      <div class="pickchips crew">
        @for (c of data.creators; track c.user_id) {
          <button
            type="button"
            class="pick"
            [class.on]="isPicked(c.user_id)"
            (click)="togglePicked(c.user_id)"
          >
            <span class="av a2">{{ c.display_name.charAt(0) }}</span>
            {{ c.display_name }}
          </button>
        } @empty {
          <p class="hint">В проекте нет креаторов — сначала добавьте состав.</p>
        }
      </div>

      <div class="monthbar">
        <p class="lbl">Дни выкладки — {{ monthTitle() }}</p>
        <span class="nav">
          <button type="button" class="btn quiet sm" (click)="shiftMonth(-1)" aria-label="Назад">
            ‹
          </button>
          <button type="button" class="btn quiet sm" (click)="shiftMonth(1)" aria-label="Вперёд">
            ›
          </button>
        </span>
      </div>

      <div class="presets">
        <button type="button" class="btn quiet sm" (click)="preset('tue_thu')">Вт и Чт</button>
        <button type="button" class="btn quiet sm" (click)="preset('mon_wed_fri')">
          Пн, Ср, Пт
        </button>
        <button type="button" class="btn quiet sm" (click)="preset('every2')">Через день</button>
        <button type="button" class="btn quiet sm" (click)="preset('clear')">Сбросить</button>
      </div>

      <div class="mcal">
        @for (w of weekdays; track w) {
          <span class="dw">{{ w }}</span>
        }
        @for (c of cells(); track c.id) {
          @if (c.date) {
            <button
              type="button"
              class="dc"
              [class.sel]="isDay(c.date)"
              [class.past]="c.past"
              (click)="toggleDay(c.date)"
            >
              {{ c.day }}
            </button>
          } @else {
            <span class="dc pad"></span>
          }
        }
      </div>

      @if (data.draftRequired) {
        <div class="switchrow">
          <span class="tx">
            <b>Черновик за {{ draftLeadDays }} дня до выкладки</b>
            <span>Вторая дата проставится автоматически от каждой выбранной</span>
          </span>
          <input
            class="lead"
            type="number"
            min="0"
            max="30"
            [(ngModel)]="draftLeadDays"
            name="lead"
          />
          <button
            type="button"
            class="sw"
            [class.on]="draftOn()"
            (click)="draftOn.set(!draftOn())"
            aria-label="Этап черновика"
          ></button>
        </div>
      }

      <div class="summarybar">
        <b>{{ picked().size }}</b>
        <span class="muted">креаторов ×</span>
        <b>{{ days().size }}</b>
        <span class="muted">дней =</span>
        <b>{{ total() }}</b>
        <span class="muted">выкладок</span>
        @if (!total()) {
          <span class="muted">— выберите людей и дни</span>
        }
      </div>

      <div class="actions">
        <button type="button" class="btn ghost sm" (click)="cancel()">Отмена</button>
        <button type="submit" class="btn primary sm" [disabled]="!total() || busy()">
          Создать выкладки
        </button>
      </div>
    </form>
  `,
  styles: [
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .crew {
        margin-bottom: 6px;
      }
      .monthbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .monthbar .lbl {
        margin: 0;
      }
      .nav {
        display: flex;
        gap: 6px;
      }
      .lead {
        width: 62px;
        padding: 8px 10px;
        border: 1px solid var(--border-strong, #2c313a);
        border-radius: var(--r-field, 10px);
        background: var(--bg-elevated, #111316);
        color: var(--text);
        font-family: inherit;
        text-align: center;
      }
      .hint {
        margin: 0;
        color: var(--text-muted);
        font-size: 12.5px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    `,
  ],
})
export class SchedulePublicationsDialogComponent {
  private readonly modalRef = inject(NzModalRef);

  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly data = inject<SchedulePublicationsData>(NZ_MODAL_DATA);

  public readonly weekdays = WEEKDAYS;

  public readonly picked = signal<Set<string>>(new Set());

  /** Выбранные дни, ключами ГГГГ-ММ-ДД — порядок задаём при отправке. */
  public readonly days = signal<Set<string>>(new Set());

  public readonly busy = signal(false);

  public readonly draftOn = signal(true);

  public draftLeadDays = 2;

  /** Какой месяц показан в календаре. Проект живёт дольше одного. */
  private readonly cursor = signal(startOfMonth(new Date()));

  public readonly monthTitle = computed(() => {
    const d = this.cursor();
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  });

  /**
   * Клетки месяца: пустышки до первого числа, чтобы числа встали под
   * своими днями недели, и сами дни. Прошедшие выключены — выкладку
   * задним числом не планируют.
   */
  public readonly cells = computed(() => {
    const first = this.cursor();
    const today = startOfDay(new Date());
    // getDay(): воскресенье — 0, а неделя у нас с понедельника.
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const out: { id: string; day: number; date: string | null; past: boolean }[] = [];
    for (let i = 0; i < lead; i += 1) out.push({ id: `pad${i}`, day: 0, date: null, past: false });
    for (let d = 1; d <= total; d += 1) {
      const date = new Date(first.getFullYear(), first.getMonth(), d);
      out.push({ id: key(date), day: d, date: key(date), past: date < today });
    }
    return out;
  });

  public readonly total = computed(() => this.picked().size * this.days().size);

  public isPicked(id: string): boolean {
    return this.picked().has(id);
  }

  public togglePicked(id: string): void {
    this.picked.set(toggled(this.picked(), id));
  }

  public isDay(date: string): boolean {
    return this.days().has(date);
  }

  public toggleDay(date: string): void {
    this.days.set(toggled(this.days(), date));
  }

  public shiftMonth(delta: number): void {
    const d = this.cursor();
    this.cursor.set(new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  /**
   * Заготовка ставит галочки в показанном месяце, не трогая другие:
   * проект на два месяца собирают по месяцу за раз, и «Вт и Чт» во втором
   * не должно стирать выбранное в первом.
   */
  public preset(p: Preset): void {
    const next = new Set(this.days());
    const month = this.cells().filter((c) => c.date && !c.past);
    for (const c of month) next.delete(c.date!);
    if (p === 'clear') {
      this.days.set(next);
      return;
    }
    for (const c of month) {
      // Из компонентов клетки, а не new Date(строка): строка «ГГГГ-ММ-ДД»
      // разбирается как полночь UTC, и в минусовых часовых поясах день
      // недели уезжает на сутки назад — «Вт и Чт» проставились бы в
      // понедельник и среду.
      const [y, m, day] = c.date!.split('-').map(Number);
      const dow = new Date(y, m - 1, day).getDay();
      const hit =
        p === 'tue_thu'
          ? dow === 2 || dow === 4
          : p === 'mon_wed_fri'
            ? dow === 1 || dow === 3 || dow === 5
            : day % 2 === 1;
      if (hit) next.add(c.date!);
    }
    this.days.set(next);
  }

  public create(): void {
    if (!this.picked().size) {
      this.msg.error('Выберите хотя бы одного креатора.');
      return;
    }
    if (!this.days().size) {
      this.msg.error('Отметьте дни выкладок в календаре.');
      return;
    }
    const req: BatchRequest = {
      creator_user_ids: [...this.picked()],
      dates: [...this.days()].sort(),
      draft_lead_days:
        this.data.draftRequired && this.draftOn() ? Number(this.draftLeadDays) || 0 : 0,
    };
    this.busy.set(true);
    this.api.managerCreateBatch(this.data.projectID, req).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.msg.success(`Создано выкладок: ${res.created}`);
        this.modalRef.destroy(res);
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось создать выкладки.').message);
      },
    });
  }

  public cancel(): void {
    this.modalRef.destroy();
  }
}

function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
