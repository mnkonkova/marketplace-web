import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { ReminderPrefs } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';

type PingField = 'day_before' | 'due_today' | 'overdue' | 'incomplete' | 'manager_digest';

// Автопинг проекта: по выключателю на каждый вид напоминания.
// Выключенное напоминание не откладывается — оно не отправляется вовсе;
// кнопка «напомнить сейчас» живёт отдельно и автопингом не управляется.
@Component({
  selector: 'app-project-autoping',
  standalone: true,
  imports: [CommonModule, FormsModule, NzSwitchModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-autoping.component.html',
  styleUrl: './project-autoping.component.scss',
})
export class ProjectAutopingComponent {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly projectId = input.required<string>();

  /**
   * В проекте работают люди со стороны.
   *
   * Четыре тумблера из пяти обещают письмо КРЕАТОРУ, и у проекта без
   * состава это обещание пустое: бэк такие напоминания не отправляет
   * вовсе — ни в личку (некому), ни в чат (шестьдесят «просрочка» за
   * одно утро по одному проекту). Их единственный след — строка в
   * дневной сводке менеджерам, и она здесь единственный тумблер,
   * который на что-то влияет. Показывать остальные четыре значило бы
   * предлагать включить то, чего не будет.
   */
  public readonly crew = input<boolean>(true);

  public readonly prefs = signal<ReminderPrefs | null>(null);

  public readonly busy = signal<PingField | null>(null);

  // Тексты из макета: под каждым тумблером — то, что реально придёт
  // человеку в бот, а не название поля.
  private readonly allRows: { field: PingField; title: string; note: string }[] = [
    {
      field: 'day_before',
      title: 'Креатору в бот — накануне срока',
      note: 'Всем на проекте сразу. Колокольчик в плане сильнее — им включают поимённо.',
    },
    {
      field: 'due_today',
      title: 'Креатору в бот — утром в день выкладки',
      note: '«Сегодня выкладка. Ссылок собрано: 0 из 5»',
    },
    {
      field: 'overdue',
      title: 'Креатору в бот — на следующий день после просрочки',
      note: 'Дальше раз в сутки, пока не появятся все пять ссылок',
    },
    {
      field: 'incomplete',
      title: 'Креатору в бот — не хватает площадок',
      note: 'Ролик вышел, но собраны не все ссылки — напомнить через сутки',
    },
    {
      field: 'manager_digest',
      title: 'Сводка в чат менеджеров',
      note: 'Раз в день: что горит и по кому. Креаторы этот чат не видят.',
    },
  ];

  /**
   * Тумблеры, которые на этом проекте что-то меняют.
   *
   * У проекта без креаторов остаётся один — сводка менеджерам.
   */
  public readonly rows = computed(() =>
    this.crew() ? this.allRows : this.allRows.filter((r) => r.field === 'manager_digest'),
  );

  public constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });
  }

  /**
   * Умолчание у «накануне» обратное остальным.
   *
   * Нет строки настроек — пингуется всё, кроме напоминания накануне: оно
   * появилось позже трёх остальных, и включать его молча всем значило бы
   * завтра утром написать каждому креатору каждого проекта, никого не
   * спросив. Поэтому «по умолчанию true» здесь не для всех полей.
   */
  public value(field: PingField): boolean {
    const p = this.prefs();
    if (!p) return field !== 'day_before';
    return p[field] ?? field !== 'day_before';
  }

  // PUT принимает частичное тело: шлём одно поле, остальные бэк не
  // трогает — так два открытых экрана менеджера не затирают друг друга.
  public toggle(field: PingField): void {
    const current = this.prefs();
    if (!current) return;
    const next = !current[field];
    // Оптимистично: тумблер отзывается сразу, на ошибке возвращается.
    this.prefs.set({ ...current, [field]: next });
    this.busy.set(field);
    this.api.managerSaveAutoping(this.projectId(), { [field]: next }).subscribe({
      next: (saved) => {
        this.busy.set(null);
        this.prefs.set(saved);
      },
      error: (e) => {
        this.busy.set(null);
        this.prefs.set(current);
        this.msg.error(parseApiError(e, 'Не удалось сохранить настройку.').message);
      },
    });
  }

  private load(id: string): void {
    this.api.managerAutoping(id).subscribe({
      next: (r) => this.prefs.set(r),
      // Проект без настроек пингуется полностью, и это же вернёт GET.
      // Молчаливый провал здесь означает «блок не показываем».
      error: () => this.prefs.set(null),
    });
  }
}
