import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

import { DocumentApi } from '@entities/document/api/document.api';
import {
  DOC_AUDIENCE_LABEL,
  DOC_KINDS,
  DOC_KIND_LABEL,
} from '@entities/document/lib/document-labels';
import { DocAudience, DocKind, DocumentTemplate } from '@entities/document/model/document.types';
import { parseApiError } from '@shared/api/api-error';
import { isTouchDevice } from '@shared/lib/touch';
import { SheetComponent } from '@shared/ui/sheet/sheet.component';

/** Что открыто в форме: новый шаблон или новая версия существующего. */
type FormMode = { kind: 'new' } | { kind: 'version'; template: DocumentTemplate };

// Шаблоны документов — рядом с прайсом и устроены так же: версия после
// публикации не правится (правка — новая версия), шаблон не удаляется, а
// уходит в архив и возвращается. Выданные по шаблону документы ссылаются
// на свою версию, и новая их не трогает.
//
// Одна разметка на десктоп и телефон — карточки: таблица из шести
// колонок на 390 px не читается. Форма на телефоне — в шторке из
// библиотеки (app-sheet), на десктопе — панелью на месте.
@Component({
  selector: 'app-document-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './document-templates.component.html',
  styleUrl: './document-templates.component.scss',
})
export class DocumentTemplatesComponent {
  private readonly api = inject(DocumentApi);

  private readonly msg = inject(NzMessageService);

  public readonly touch = isTouchDevice();

  public readonly kindLabel = DOC_KIND_LABEL;

  public readonly kinds = DOC_KINDS;

  public readonly audienceLabel = DOC_AUDIENCE_LABEL;

  public readonly items = signal<DocumentTemplate[]>([]);

  public readonly loading = signal(true);

  public readonly busy = signal(false);

  /** Действующие или архив. Архив — отдельно: он не удалён, просто не в выборе. */
  public readonly showArchive = signal(false);

  public readonly shown = computed(() =>
    this.items().filter((t) => !!t.archived_at === this.showArchive()),
  );

  public readonly archivedCount = computed(() => this.items().filter((t) => t.archived_at).length);

  /** Чья история версий раскрыта. */
  public readonly openHistory = signal('');

  public readonly form = signal<FormMode | null>(null);

  public draft = this.emptyDraft();

  public constructor() {
    this.load();
  }

  private emptyDraft() {
    return {
      kind: 'contract' as DocKind,
      title: '',
      audience: 'creators' as DocAudience,
      url: '',
      note: '',
    };
  }

  public load(): void {
    this.api.adminTemplates(true).subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить шаблоны.').message);
      },
    });
  }

  public toggleHistory(id: string): void {
    this.openHistory.set(this.openHistory() === id ? '' : id);
  }

  public startNew(): void {
    this.draft = this.emptyDraft();
    this.form.set({ kind: 'new' });
  }

  public startVersion(t: DocumentTemplate): void {
    this.draft = { ...this.emptyDraft(), url: t.current?.url ?? '' };
    this.form.set({ kind: 'version', template: t });
  }

  public cancel(): void {
    this.form.set(null);
  }

  public formTitle(): string {
    const f = this.form();
    return f?.kind === 'version' ? `Новая версия · ${f.template.title}` : 'Новый шаблон';
  }

  public canSave(): boolean {
    const f = this.form();
    if (!f || this.busy() || !this.draft.url.trim()) return false;
    return f.kind === 'version' || !!this.draft.title.trim();
  }

  public save(): void {
    const f = this.form();
    if (!f || !this.canSave()) return;
    this.busy.set(true);
    const done = (text: string) => {
      this.busy.set(false);
      this.form.set(null);
      this.msg.success(text);
      this.load();
    };
    const fail = (e: unknown) => {
      this.busy.set(false);
      this.msg.error(parseApiError(e, 'Не удалось сохранить.').message);
    };
    if (f.kind === 'version') {
      this.api
        .adminPublishVersion(f.template.id, this.draft.url.trim(), this.draft.note.trim())
        .subscribe({ next: (v) => done(`Опубликована версия ${v.version}.`), error: fail });
      return;
    }
    this.api
      .adminCreateTemplate({
        kind: this.draft.kind,
        title: this.draft.title.trim(),
        audience: this.draft.audience,
        url: this.draft.url.trim(),
        note: this.draft.note.trim(),
      })
      .subscribe({ next: () => done('Шаблон заведён.'), error: fail });
  }

  public setArchived(t: DocumentTemplate, archived: boolean): void {
    if (this.busy()) return;
    this.busy.set(true);
    const call = archived
      ? this.api.adminArchiveTemplate(t.id)
      : this.api.adminRestoreTemplate(t.id);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.msg.success(archived ? 'Шаблон в архиве.' : 'Шаблон снова в выборе.');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не получилось.').message);
      },
    });
  }
}
