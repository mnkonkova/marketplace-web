import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
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
// («открыть в новой вкладке») — тоже клик: auxclick. Правый — нет: им
// открывают меню, чтобы скопировать ссылку.
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

  /** Только документы этого проекта; пусто — по всем. */
  public readonly projectId = input('');

  /** Подпись проекта у строки — нужна, когда список по всем проектам. */
  public readonly showProject = input(true);

  /**
   * Только выданное лично. Для страницы, где договоры из материалов
   * проекта и так стоят рядом в списке материалов, — иначе один договор
   * показан дважды.
   */
  public readonly personalOnly = input(false);

  /**
   * Своей панелью (по умолчанию) или разделом внутри чужой: в карточке
   * проекта креатора документы стоят в одной панели с чек-листом.
   */
  public readonly framed = input(true);

  /**
   * Перезагрузить список: страница меняет число, когда обновляет свои
   * данные, — иначе новый договор не попал бы ни в материалы (они его
   * отфильтровывают), ни сюда.
   */
  public readonly refresh = input(0);

  public readonly kindLabel = DOC_KIND_LABEL;

  private readonly all = signal<MyDocument[]>([]);

  // Сервер уже отфильтровал по проекту и источнику. Повтор здесь —
  // страховка на выкатку: API без этих параметров их молча пропустит и
  // отдаст документы всех проектов, а подписи проекта у строк в
  // карточке нет — чужой договор выглядел бы своим.
  public readonly items = computed(() => {
    const id = this.projectId();
    const personal = this.personalOnly();
    return this.all().filter(
      (d) => (!id || d.project_id === id) && (!personal || d.source === 'personal'),
    );
  });

  private loadSeq = 0;

  public constructor() {
    effect(() => {
      const id = this.projectId();
      const personal = this.personalOnly();
      this.refresh();
      const seq = ++this.loadSeq;
      untracked(() =>
        this.api.myDocuments(id, personal).subscribe({
          next: (r) => seq === this.loadSeq && this.all.set(r.items ?? []),
          error: () => seq === this.loadSeq && this.all.set([]),
        }),
      );
    });
  }

  /** Средний клик — открыть во вкладке; правый — меню, не открытие. */
  public aux(e: MouseEvent, d: MyDocument): void {
    if (e.button === 1) this.opened(d);
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
