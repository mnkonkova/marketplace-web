import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  ALL_PLATFORMS,
  ChecklistTemplate,
  ChecklistTemplateItem,
  Platform,
} from '@entities/publication/model/publication.types';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import { parseApiError } from '@shared/api/api-error';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

/** Строка редактора: то же, что пункт шаблона, но с ключом для track. */
interface Row extends ChecklistTemplateItem {
  key: number;
}

/**
 * Чеклисты креаторов — что креатор отмечает перед тем, как сдать ссылки.
 *
 * Ведёт их админ: пункты одинаковы для всех проектов, и держать их у
 * каждого менеджера своим набором значило бы спрашивать с креаторов
 * разное за одну и ту же работу. Менеджер в проекте только подключает
 * шаблон и правит копию внутри проекта.
 *
 * Правки на месте здесь нет намеренно: шаблон уходит в проект снимком.
 * «Сохранить» выпускает следующую версию и гасит прежнюю — идущие
 * проекты продолжают жить по той, с которой начинались.
 */
@Component({
  selector: 'app-admin-checklists',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './checklists.page.html',
  styleUrl: './checklists.page.scss',
})
export class AdminChecklistsPage implements OnInit {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  public readonly platforms = ALL_PLATFORMS;

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly items = signal<ChecklistTemplate[]>([]);

  public readonly loading = signal(true);

  public readonly saving = signal(false);

  /** Открыт редактор: null — закрыт, '' — новый шаблон, id — версия. */
  public readonly editing = signal<string | null>(null);

  public name = '';

  public description = '';

  public readonly rows = signal<Row[]>([]);

  private nextKey = 1;

  public ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.adminChecklistTemplates().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить библиотеку.').message);
      },
    });
  }

  public startNew(): void {
    this.name = '';
    this.description = '';
    this.rows.set([this.blank()]);
    this.editing.set('');
  }

  /** Правка — это копия действующей версии, из которой выпустят новую. */
  public startEdit(t: ChecklistTemplate): void {
    this.api.adminChecklistTemplate(t.id).subscribe({
      next: (full) => {
        this.name = full.name;
        this.description = full.description ?? '';
        // platform у общего пункта сервер не присылает вовсе, а select
        // ждёт пустую строку: с undefined он не находит своего варианта
        // и показывает пустоту вместо «Все площадки».
        this.rows.set(
          full.items.map((i) => ({ ...i, platform: i.platform ?? '', key: this.nextKey++ })),
        );
        if (!this.rows().length) this.rows.set([this.blank()]);
        this.editing.set(full.id);
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось открыть шаблон.').message),
    });
  }

  public close(): void {
    this.editing.set(null);
  }

  public addRow(): void {
    this.rows.set([...this.rows(), this.blank()]);
  }

  public removeRow(key: number): void {
    const next = this.rows().filter((r) => r.key !== key);
    this.rows.set(next.length ? next : [this.blank()]);
  }

  public setText(key: number, text: string): void {
    this.patch(key, { text });
  }

  public setPlatform(key: number, platform: Platform | ''): void {
    this.patch(key, { platform });
  }

  public toggleRequired(key: number): void {
    const row = this.rows().find((r) => r.key === key);
    if (row) this.patch(key, { is_required: !row.is_required });
  }

  private patch(key: number, part: Partial<Row>): void {
    this.rows.set(this.rows().map((r) => (r.key === key ? { ...r, ...part } : r)));
  }

  private blank(): Row {
    return { key: this.nextKey++, text: '', platform: '', is_required: true };
  }

  public save(): void {
    const items = this.rows()
      .map(({ text, platform, is_required }) => ({ text: text.trim(), platform, is_required }))
      .filter((i) => i.text);
    if (!this.name.trim()) {
      this.msg.error('У шаблона должно быть название.');
      return;
    }
    if (!items.length) {
      this.msg.error('Шаблон без пунктов ничего не проверяет.');
      return;
    }
    const replaces = this.editing();
    this.saving.set(true);
    this.api
      .adminSaveChecklistTemplate({
        replaces: replaces || undefined,
        name: this.name.trim(),
        description: this.description.trim(),
        items,
      })
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.editing.set(null);
          this.msg.success(
            saved.version > 1 ? `Выпущена версия ${saved.version}` : 'Шаблон добавлен',
          );
          this.load();
        },
        error: (e) => {
          this.saving.set(false);
          this.msg.error(parseApiError(e, 'Не удалось сохранить шаблон.').message);
        },
      });
  }

  public remove(t: ChecklistTemplate): void {
    this.modal.confirm({
      nzTitle: `Убрать «${t.name}» из библиотеки?`,
      nzContent:
        'Проекты, где он уже подключён, не изменятся: у них свой снимок. ' +
        'Новые подключить будет нельзя.',
      nzOnOk: () =>
        this.api.adminDeleteChecklistTemplate(t.id).subscribe({
          next: () => {
            this.msg.success('Шаблон убран из библиотеки');
            this.load();
          },
          error: (e) => this.msg.error(parseApiError(e, 'Не удалось убрать шаблон.').message),
        }),
    });
  }
}
