import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  CdkDragDrop,
  CdkDropList,
  CdkDrag,
  CdkDropListGroup,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import { ProjectManagerView, StepOwner } from '@entities/project/model/project.types';
import { PipelineFull } from '@entities/pipeline/model/pipeline.types';
import { buildBoardColumns, currentStepId } from '@entities/project/lib/board-columns';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '@shared/lib/project-status';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';
import { BoardListViewComponent } from '@widgets/board-list-view/board-list-view.component';
import { StageMoveSheetComponent } from '@widgets/stage-move-sheet/stage-move-sheet.component';

import { BoardColumn, BoardForPipeline as GenericBoard } from '@entities/project/model/board.types';
import { withFromPage } from '@shared/nav/from-page';

// Локальный alias — затягиваем конкретный pipeline-тип.
type BoardForPipeline = GenericBoard<PipelineFull>;

/**
 * Канбан проектов менеджера.
 *
 * Был отдельной страницей на `/manager/board`; теперь это вид раздела
 * «Проекты» — свой заголовок и своя кнопка «Создать проект» ему больше не
 * нужны, их даёт раздел.
 */
@Component({
  selector: 'app-manager-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkScrollable,
    NzSelectModule,
    ListStateComponent,
    StatusTagComponent,
    BoardListViewComponent,
    StageMoveSheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.page.html',
  styleUrl: './board.page.scss',
})
export class ManagerBoardComponent implements OnInit {
  protected readonly projectApi = inject(ProjectApi);

  protected readonly pipelineApi = inject(PipelineApi);

  protected readonly router = inject(Router);

  protected readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  /**
   * Ошибка сборки доски — отдельно от «проектов нет». Раньше упавший
   * запрос гасил спиннер и оставлял пустой экран, неотличимый от честного
   * «в работе ничего».
   */
  public readonly error = signal<string | null>(null);

  public readonly boards = signal<BoardForPipeline[]>([]);

  public readonly selectedPipelineId = signal<string>('');

  public readonly currentBoard = computed(
    () => this.boards().find((b) => b.pipeline.id === this.selectedPipelineId()) ?? null,
  );

  /** Список (accordion) вместо канбана: тач-устройство ИЛИ узкое окно
   *  (≤ bp.$touch = 720px). Реактивно реагирует на resize. */
  public readonly isListMode = signal(false);

  /** Состояние bottom-sheet «Переместить в…». */
  public readonly moveSheetOpen = signal(false);
  public readonly moveTarget = signal<ProjectManagerView | null>(null);

  public readonly moveTargetCurrentStepId = computed<string>(() => {
    const p = this.moveTarget();
    const cb = this.currentBoard();
    if (!p || !cb) return '';
    // Шаг проекта — копия шага воронки со своим id, поэтому ищем по
    // позиции, а не по идентификатору (см. lib/board-columns).
    return currentStepId(cb.columns, p);
  });

  constructor() {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(pointer: coarse), (max-width: 720px)');
    this.isListMode.set(mql.matches);
    const handler = (e: MediaQueryListEvent): void => this.isListMode.set(e.matches);
    mql.addEventListener('change', handler);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', handler));
  }

  public ngOnInit(): void {
    this.fetch();
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusTone(s: ProjectManagerView['display_status']): StatusTone {
    return PROJECT_STATUS_TONE[s];
  }

  public ownerIcon(o: StepOwner): string {
    switch (o) {
      case 'client':
        return '👤';
      case 'team':
        return '👥';
      case 'system':
        return '🤖';
    }
  }

  public ownerLabel(o: StepOwner): string {
    switch (o) {
      case 'client':
        return 'клиент';
      case 'team':
        return 'команда';
      case 'system':
        return 'авто (n8n)';
    }
  }

  public open(p: ProjectManagerView): void {
    void this.router.navigate(['/manager/projects', p.id], withFromPage(this.router));
  }

  // === Bottom-sheet «Переместить» (тач-режим) ===

  public onLongPress(p: ProjectManagerView): void {
    this.moveTarget.set(p);
    this.moveSheetOpen.set(true);
  }

  public closeMoveSheet(): void {
    this.moveSheetOpen.set(false);
  }

  public openMoveTargetProject(): void {
    const p = this.moveTarget();
    if (!p) return;
    this.moveSheetOpen.set(false);
    this.open(p);
  }

  public onSelectMoveStep(stepId: string): void {
    const target = this.moveTarget();
    if (!target) return;
    this.moveSheetOpen.set(false);
    const cb = this.currentBoard();
    if (!cb) return;
    const fromCol = cb.columns.find((c) => c.items.some((i) => i.id === target.id));
    const toCol = cb.columns.find((c) => c.step_id === stepId);
    if (!fromCol || !toCol || fromCol === toCol) return;

    // Optimistic. Иммутабельно: BoardListView получает board через input
    // signal, который реагирует на смену reference. Мутация in-place у
    // канбана работала через @for inline, у списка — нет.
    const prevBoards = this.boards();
    const newColumns = cb.columns.map((c) => {
      if (c === fromCol) return { ...c, items: c.items.filter((i) => i.id !== target.id) };
      if (c === toCol) return { ...c, items: [...c.items, target] };
      return c;
    });
    this.boards.set(
      prevBoards.map((b) => (b.pipeline.id === cb.pipeline.id ? { ...b, columns: newColumns } : b)),
    );

    this.moveStep(target.id, stepId, target.updated_at).subscribe({
      next: (updated) => {
        // target — это ссылка на объект, который теперь в newColumns[toCol].items.
        // Мутируем поля проекта (id трекается, перерисовка не нужна).
        Object.assign(target, {
          current_step_id: updated.current_step_id,
          current_step_title: updated.current_step_title,
          current_step_owner: updated.current_step_owner,
          current_step_status: updated.current_step_status,
          current_stage_name: toCol.stage_name,
          display_status: updated.display_status,
          updated_at: updated.updated_at,
        });
        this.msg.success('Шаг обновлён');
      },
      error: (e) => {
        // Откат: вернуть прежний snapshot.
        this.boards.set(prevBoards);
        const code = e?.error?.error as string | undefined;
        if (code === 'stale_updated_at') {
          this.msg.warning('Проект уже обновили — перезагружаю...');
          this.fetch();
        } else if (code === 'not_found') {
          this.msg.error('Шаг не найден');
        } else {
          this.msg.error('Не удалось перенести');
        }
      },
    });
  }

  // onDrop — переносим проект на конкретный ШАГ через MoveProjectToStep.
  // Бэк сам отрулит промежуточные team/system шаги, заблокирует пропуск
  // незавершённого client-шага.
  public onDrop(event: CdkDragDrop<ProjectManagerView[]>, targetCol: BoardColumn): void {
    if (event.previousContainer === event.container) return;
    const project = event.item.data as ProjectManagerView;

    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );
    this.boards.set([...this.boards()]);

    this.moveStep(project.id, targetCol.step_id, project.updated_at).subscribe({
      next: (updated) => {
        Object.assign(project, {
          current_step_id: updated.current_step_id,
          current_step_title: updated.current_step_title,
          current_step_owner: updated.current_step_owner,
          current_step_status: updated.current_step_status,
          current_stage_name: targetCol.stage_name,
          display_status: updated.display_status,
          updated_at: updated.updated_at,
        });
        this.msg.success('Шаг обновлён');
      },
      error: (e) => {
        transferArrayItem(
          event.container.data,
          event.previousContainer.data,
          event.currentIndex,
          event.previousIndex,
        );
        this.boards.set([...this.boards()]);
        const code = e?.error?.error as string | undefined;
        if (code === 'stale_updated_at') {
          this.msg.warning('Проект уже обновили — перезагружаю...');
          this.fetch();
        } else if (code === 'not_found') {
          this.msg.error('Шаг не найден');
        } else {
          this.msg.error('Не удалось перенести');
        }
      },
    });
  }

  // Перегружаемое — admin board использует adminMoveStep.
  protected moveStep(projectId: string, targetStepId: string, updatedAt?: string) {
    return this.projectApi.managerMoveStep(projectId, targetStepId, updatedAt);
  }

  protected loadProjects() {
    return this.projectApi.managerAssigned();
  }

  public get selected(): string {
    return this.selectedPipelineId();
  }

  public set selected(v: string) {
    this.selectedPipelineId.set(v);
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.loadProjects().subscribe({
      next: (r) => {
        const byPipeline = new Map<string, ProjectManagerView[]>();
        for (const p of r.items) {
          // У общего проекта воронки нет, и поля тоже: раскладывать его
          // по этапам нечем, а раньше он собирался в доску с пустым id.
          const pipelineId = p.pipeline_id;
          if (!pipelineId) continue;
          if (!byPipeline.has(pipelineId)) {
            byPipeline.set(pipelineId, []);
          }
          byPipeline.get(pipelineId)!.push(p);
        }

        if (byPipeline.size === 0) {
          this.boards.set([]);
          this.loading.set(false);
          return;
        }

        const pipelineIds = Array.from(byPipeline.keys());
        forkJoin(pipelineIds.map((id) => this.pipelineApi.getFull(id))).subscribe({
          next: (pipelines) => {
            const boards: BoardForPipeline[] = pipelines.map((pl) => ({
              pipeline: pl,
              columns: buildBoardColumns(pl, byPipeline.get(pl.id) ?? []),
            }));
            this.boards.set(boards);
            if (!boards.some((b) => b.pipeline.id === this.selectedPipelineId())) {
              this.selectedPipelineId.set(boards[0]?.pipeline.id ?? '');
            }
            this.loading.set(false);
          },
          error: (e) => this.fail(e),
        });
      },
      error: (e) => this.fail(e),
    });
  }

  private fail(e: unknown): void {
    this.loading.set(false);
    this.error.set(parseApiError(e, 'Не удалось собрать канбан.').message);
  }
}
