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
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

import { DocumentApi } from '@entities/document/api/document.api';
import { DOC_KINDS, DOC_KIND_LABEL } from '@entities/document/lib/document-labels';
import {
  DocAudience,
  DocKind,
  DocumentTemplate,
  UserDocument,
} from '@entities/document/model/document.types';
import type { ProjectPerson } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { isTouchDevice } from '@shared/lib/touch';
import { SheetComponent } from '@shared/ui/sheet/sheet.component';

// Документы проекта у менеджера: выдать договор, акт или NDA конкретному
// креатору, всему составу или заказчику — и видеть, кому что выдано и
// открыл ли адресат.
//
// Ничего не удаляется: выданное отзывают (у адресата пропадает, здесь
// остаётся приглушённым) и могут вернуть. Ответа «подписал» нет —
// подписанный экземпляр человек присылает в переписку проекта.
//
// Форма на телефоне — в шторке из библиотеки (app-sheet), на десктопе —
// панелью на месте, как у аккаунтов.
@Component({
  selector: 'app-project-documents',
  standalone: true,
  imports: [CommonModule, FormsModule, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-documents.component.html',
  styleUrl: './project-documents.component.scss',
})
export class ProjectDocumentsComponent {
  private readonly api = inject(DocumentApi);

  private readonly msg = inject(NzMessageService);

  public readonly projectId = input.required<string>();

  public readonly projectTitle = input('');

  /** Состав проекта — кому из креаторов можно выдать. */
  public readonly crew = input<readonly ProjectPerson[]>([]);

  /** Есть ли у проекта креаторы вообще (у проекта бренда — нет). */
  public readonly hasCrew = input(true);

  /** Имя заказчика; пусто — заказчика у проекта нет, выдавать некому. */
  public readonly clientName = input('');

  public readonly touch = isTouchDevice();

  public readonly kindLabel = DOC_KIND_LABEL;

  public readonly kinds = DOC_KINDS;

  public readonly items = signal<UserDocument[]>([]);

  public readonly loading = signal(true);

  public readonly busy = signal(false);

  public readonly templates = signal<DocumentTemplate[]>([]);

  public readonly formOpen = signal(false);

  // Номер последнего запроса: ответ старого (смена проекта, повторное
  // открытие формы) не должен перезаписать свежие данные — иначе в
  // проекте Б показались бы документы проекта А с кнопками отзыва,
  // бьющими в адрес Б.
  private loadSeq = 0;

  private tplSeq = 0;

  // ---- черновик выдачи ----

  public readonly audience = signal<DocAudience>('creators');

  /** Отмеченные креаторы. Пусто при «всем» — выдача всему составу. */
  public readonly picked = signal<Set<string>>(new Set());

  public readonly toAll = signal(true);

  public readonly source = signal<'template' | 'custom'>('template');

  public readonly templateId = signal('');

  public custom = { kind: 'contract' as DocKind, title: '', url: '' };

  public note = '';

  public readonly audienceTemplates = computed(() =>
    this.templates().filter((t) => t.audience === this.audience()),
  );

  public readonly pickedCount = computed(() =>
    this.toAll() ? this.crew().length : this.picked().size,
  );

  public constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });
  }

  private load(id: string): void {
    const seq = ++this.loadSeq;
    this.api.managerProjectDocuments(id).subscribe({
      next: (r) => {
        if (seq !== this.loadSeq) return;
        this.items.set(r.items ?? []);
        this.loading.set(false);
      },
      error: (e) => {
        if (seq !== this.loadSeq) return;
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить документы.').message);
      },
    });
  }

  public open(): void {
    this.audience.set(this.hasCrew() && this.crew().length ? 'creators' : 'client');
    this.toAll.set(true);
    this.picked.set(new Set());
    this.source.set('template');
    this.templateId.set('');
    this.custom = { kind: 'contract', title: '', url: '' };
    this.note = '';
    this.formOpen.set(true);
    // Шаблоны — при открытии: их правят в админке, и вчерашний список
    // предложил бы версию, которой уже нет.
    const seq = ++this.tplSeq;
    this.api.managerTemplates().subscribe({
      next: (r) => {
        if (seq !== this.tplSeq) return;
        this.templates.set(r.items ?? []);
        if (!this.audienceTemplates().length) this.source.set('custom');
      },
      error: () => {
        if (seq === this.tplSeq) this.source.set('custom');
      },
    });
  }

  public close(): void {
    this.formOpen.set(false);
  }

  public setAudience(a: DocAudience): void {
    this.audience.set(a);
    this.templateId.set('');
    if (!this.audienceTemplates().length) this.source.set('custom');
  }

  public togglePerson(id: string): void {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
    this.toAll.set(false);
  }

  public setAll(on: boolean): void {
    this.toAll.set(on);
    if (on) this.picked.set(new Set());
  }

  /** Выдать можно, когда понятно и кому, и что. */
  public canSend(): boolean {
    if (this.busy()) return false;
    if (this.audience() === 'creators') {
      // «Всем в составе» при пустом составе — выдать некому.
      if (this.toAll() ? !this.crew().length : !this.picked().size) return false;
    }
    if (this.audience() === 'client' && !this.clientName()) return false;
    if (this.source() === 'template') return !!this.templateId();
    return !!this.custom.title.trim() && !!this.custom.url.trim();
  }

  public send(): void {
    if (!this.canSend()) return;
    this.busy.set(true);
    const recipients =
      this.audience() === 'creators' && !this.toAll() ? [...this.picked()] : undefined;
    const body =
      this.source() === 'template'
        ? { template_id: this.templateId() }
        : {
            kind: this.custom.kind,
            title: this.custom.title.trim(),
            url: this.custom.url.trim(),
          };
    this.api
      .managerDeliver(this.projectId(), {
        audience: this.audience(),
        recipient_ids: recipients,
        note: this.note.trim(),
        ...body,
      })
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          this.formOpen.set(false);
          const n = r.items?.length ?? 0;
          if (!n) {
            // Сервер ничего не выдал — «выдан» здесь было бы неправдой.
            this.msg.error('Документ никому не выдан: адресатов не нашлось.');
            return;
          }
          this.msg.success(n > 1 ? `Выдано: ${n} адресатам.` : 'Документ выдан.');
          this.load(this.projectId());
        },
        error: (e) => {
          this.busy.set(false);
          this.msg.error(parseApiError(e, 'Не удалось выдать документ.').message);
        },
      });
  }

  public setRevoked(d: UserDocument, revoke: boolean): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.managerRevoke(this.projectId(), d.id, revoke).subscribe({
      next: () => {
        this.busy.set(false);
        this.msg.success(revoke ? 'Документ отозван.' : 'Документ снова у адресата.');
        this.load(this.projectId());
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не получилось.').message);
      },
    });
  }

  public sourceLabel(d: UserDocument): string {
    return d.template_version ? `по шаблону v${d.template_version}` : 'своя ссылка';
  }
}
