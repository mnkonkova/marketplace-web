import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DocumentApi } from '@entities/document/api/document.api';
import { DOC_KIND_LABEL } from '@entities/document/lib/document-labels';
import { MyDocument } from '@entities/document/model/document.types';

// «Мои документы» — креатора и заказчика: выданное лично и договоры из
// материалов проектов, одним списком.
//
// Личный документ при переходе по ссылке отмечается открытым: менеджер
// видит, что он дошёл. Отметку ставим на клик, а не на показ списка —
// «увидел строку» и «открыл документ» не одно и то же. Средний клик
// («открыть в новой вкладке») — тоже клик: auxclick.
//
// Блока нет вовсе, пока документов нет: пустая панель «документов пока
// нет» читается как недоделка, а не как состояние дел.
@Component({
  selector: 'app-my-documents',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-documents.component.html',
  styleUrl: './my-documents.component.scss',
})
export class MyDocumentsComponent {
  private readonly api = inject(DocumentApi);

  /** Только документы этого проекта; пусто — по всем проектам. */
  public readonly projectId = input('');

  /** Подпись проекта у строки — нужна, когда список по всем проектам. */
  public readonly showProject = input(true);

  public readonly kindLabel = DOC_KIND_LABEL;

  private readonly all = signal<MyDocument[]>([]);

  public readonly items = computed(() => {
    const id = this.projectId();
    return id ? this.all().filter((d) => d.project_id === id) : this.all();
  });

  public constructor() {
    this.api.myDocuments().subscribe({
      next: (r) => this.all.set(r.items ?? []),
      error: () => this.all.set([]),
    });
  }

  public opened(d: MyDocument): void {
    if (d.source !== 'personal' || d.opened_at) return;
    this.api.markOpened(d.id).subscribe({
      next: (r) =>
        this.all.update((list) =>
          list.map((x) => (x.id === d.id ? { ...x, opened_at: r.opened_at } : x)),
        ),
      error: () => undefined,
    });
  }
}
