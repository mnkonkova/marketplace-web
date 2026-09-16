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
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  ChecklistItem,
  ChecklistSnapshot,
  ChecklistTemplate,
  ALL_PLATFORMS,
} from '@entities/publication/model/publication.types';
import { commonItems, itemsForPlatform } from '@entities/publication/lib/checklist';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import { parseApiError } from '@shared/api/api-error';

// Чеклист выкладки глазами менеджера: снимок, подключённый к проекту, и
// библиотека, из которой он взят. Правки в снимке остаются внутри проекта.
//
// «Обновить до v4» — это повторный снимок с template_id нужной версии:
// отдельной ручки обновления в API нет, и придумывать её не надо.
@Component({
  selector: 'app-project-checklist',
  standalone: true,
  imports: [CommonModule, NzButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-checklist.component.html',
  styleUrl: './project-checklist.component.scss',
})
export class ProjectChecklistComponent {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  public readonly projectId = input.required<string>();

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly items = signal<ChecklistItem[]>([]);

  public readonly templates = signal<ChecklistTemplate[]>([]);

  // Какой шаблон и какой версии подключён. Бэк обещал отдавать его в
  // ответе чеклиста; в swagger поля пока нет, поэтому блок версии рисуем
  // только когда оно реально пришло — иначе соврали бы про «v3».
  public readonly snapshot = signal<ChecklistSnapshot | null>(null);

  public readonly libraryOpen = signal(false);

  public readonly busy = signal(false);

  public constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });
  }

  public readonly ordered = computed(() =>
    [...this.items()].sort((a, b) => a.sort_order - b.sort_order),
  );

  // Пункты теми же группами, в каких их видит креатор в окне сдачи:
  // сначала общие, потом площадочные. Раньше менеджеру доставался
  // плоский список с приписками «TikTok», и на вопрос, ради которого
  // сюда и заходят — «что креатор увидит, когда нажмёт сдать», — он не
  // отвечал. Разбор берём из общей библиотеки чеклиста: своя копия
  // правила «пункт без площадки — общий» разошлась бы с сервером.
  public readonly common = computed(() => commonItems(this.ordered()));

  /** Только те площадки, у которых пункты есть: пустой заголовок — мусор. */
  public readonly byPlatform = computed(() =>
    ALL_PLATFORMS.map((platform) => ({
      platform,
      items: itemsForPlatform(this.ordered(), platform),
    })).filter((g) => g.items.length > 0),
  );

  public readonly requiredCount = computed(() => this.items().filter((i) => i.is_required).length);

  // Вышла ли в библиотеке версия свежее подключённой. Считаем по
  // latest_version снимка, а при его отсутствии — по библиотеке: там
  // видно максимальную версию шаблона с тем же именем.
  public readonly newerVersion = computed<number | null>(() => {
    const snap = this.snapshot();
    if (!snap) return null;
    const fromSnapshot = snap.latest_version ?? 0;
    const fromLibrary = this.templates()
      .filter((t) => t.name === snap.template_name)
      .reduce((max, t) => Math.max(max, t.version), 0);
    const latest = Math.max(fromSnapshot, fromLibrary);
    return latest > snap.template_version ? latest : null;
  });

  // Шаблон нужной версии для кнопки «обновить». Отдельной ручки обновления
  // нет: это повторный снимок с template_id той версии.
  public readonly upgradeTarget = computed<ChecklistTemplate | null>(() => {
    const snap = this.snapshot();
    const version = this.newerVersion();
    if (!snap || !version) return null;
    return (
      this.templates().find((t) => t.name === snap.template_name && t.version === version) ?? null
    );
  });

  // Самая свежая версия каждого шаблона библиотеки.
  public readonly newest = computed(() => {
    const byName = new Map<string, ChecklistTemplate>();
    for (const t of this.templates()) {
      const prev = byName.get(t.name);
      if (!prev || t.version > prev.version) byName.set(t.name, t);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  public toggleLibrary(): void {
    this.libraryOpen.set(!this.libraryOpen());
  }

  public connect(t: ChecklistTemplate): void {
    this.modal.confirm({
      nzTitle: `Подключить «${t.name}» v${t.version}?`,
      nzContent:
        'Снимок заменит текущий чеклист проекта. Уже сданные выкладки не тронутся — ' +
        'чеклист проверяется в момент сдачи ссылок.',
      nzOnOk: () => {
        this.busy.set(true);
        this.api.managerSnapshotChecklist(this.projectId(), t.id).subscribe({
          next: (r) => {
            this.busy.set(false);
            this.libraryOpen.set(false);
            this.msg.success(`Подключено пунктов: ${r.copied}`);
            this.load(this.projectId());
          },
          error: (e) => {
            this.busy.set(false);
            this.msg.error(parseApiError(e, 'Не удалось подключить чеклист.').message);
          },
        });
      },
    });
  }

  private load(id: string): void {
    this.api.managerChecklist(id).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.snapshot.set(r.template ?? null);
      },
      error: () => {
        this.items.set([]);
        this.snapshot.set(null);
      },
    });
    this.api.managerChecklistTemplates().subscribe({
      next: (r) => this.templates.set(r.items),
      // Выключенные шаблоны бэк не отдаёт; пустая библиотека — не ошибка.
      error: () => this.templates.set([]),
    });
  }
}
