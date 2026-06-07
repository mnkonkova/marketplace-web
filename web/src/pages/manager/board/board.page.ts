import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
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
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import { CreateProjectDialogComponent } from '@features/create-project/create-project.dialog';
import { ProjectManagerView, StepOwner } from '@entities/project/model/project.types';
import { PipelineFull } from '@entities/pipeline/model/pipeline.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { ManagerLayoutComponent } from '@widgets/manager-layout/manager-layout.component';
import { BoardListViewComponent } from '@widgets/board-list-view/board-list-view.component';
import { StageMoveSheetComponent } from '@widgets/stage-move-sheet/stage-move-sheet.component';

import { BoardColumn, BoardForPipeline as GenericBoard } from '@entities/project/model/board.types';
import { withFromPage } from '@shared/nav/from-page';

// Локальный alias — затягиваем конкретный pipeline-тип.
type BoardForPipeline = GenericBoard<PipelineFull>;

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
    NzSpinModule,
    NzTagModule,
    NzEmptyModule,
    NzSelectModule,
    NzButtonModule,
    ManagerLayoutComponent,
    BoardListViewComponent,
    StageMoveSheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.page.html',
  styleUrl: './board.page.scss',
})
export class ManagerBoardPage implements OnInit {
  protected readonly projectApi = inject(ProjectApi);

  protected readonly pipelineApi = inject(PipelineApi);

  protected readonly router = inject(Router);

  protected readonly msg = inject(NzMessageService);

  protected readonly modal = inject(NzModalService);

  public readonly loading = signal(true);

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
    if (!p) return '';
    const cb = this.currentBoard();
    if (!cb) return '';
    // current_step_title — текстовое поле проекта; находим step по name внутри pipeline.
    for (const st of cb.pipeline.stages) {
      for (const sp of st.steps ?? []) {
        if (sp.name === p.current_step_title) return sp.id;
      }
    }
    return '';
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

  public statusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public ownerIcon(o: StepOwner): string {
    switch (o) {
      case 'client': return '👤';
      case 'team':   return '👥';
      case 'system': return '🤖';
    }
  }

  public ownerLabel(o: StepOwner): string {
    switch (o) {
      case 'client': return 'клиент';
      case 'team':   return 'команда';
      case 'system': return 'авто (n8n)';
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
      prevBoards.map((b) =>
        b.pipeline.id === cb.pipeline.id ? { ...b, columns: newColumns } : b,
      ),
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

  protected fetch(): void {
    this.loading.set(true);
    this.loadProjects().subscribe({
      next: (r) => {
        const byPipeline = new Map<string, ProjectManagerView[]>();
        for (const p of r.items) {
          if (!byPipeline.has(p.pipeline_id)) {
            byPipeline.set(p.pipeline_id, []);
          }
          byPipeline.get(p.pipeline_id)!.push(p);
        }

        if (byPipeline.size === 0) {
          this.boards.set([]);
          this.loading.set(false);
          return;
        }

        const pipelineIds = Array.from(byPipeline.keys());
        forkJoin(pipelineIds.map((id) => this.pipelineApi.getFull(id))).subscribe({
          next: (pipelines) => {
            const boards: BoardForPipeline[] = pipelines.map((pl) => {
              const projects = byPipeline.get(pl.id) ?? [];
              const cols: BoardColumn[] = [];
              const stagesSorted = pl.stages
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order);
              for (const st of stagesSorted) {
                const stepsSorted = (st.steps ?? [])
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order);
                for (const sp of stepsSorted) {
                  cols.push({
                    step_id: sp.id,
                    step_name: sp.name,
                    step_owner: sp.owner,
                    stage_name: st.name,
                    stage_order: st.sort_order,
                    step_order: sp.sort_order,
                    items: projects.filter((p) => p.current_step_title === sp.name),
                  });
                }
              }
              return { pipeline: pl, columns: cols };
            });
            this.boards.set(boards);
            if (!boards.some((b) => b.pipeline.id === this.selectedPipelineId())) {
              this.selectedPipelineId.set(boards[0]?.pipeline.id ?? '');
            }
            this.loading.set(false);
          },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.loading.set(false),
    });
  }

  public openCreate(): void {
    const ref = this.modal.create({
      nzTitle: 'Создать проект',
      nzContent: CreateProjectDialogComponent,
      nzFooter: null,
      nzWidth: 520,
      nzData: { mode: 'manager' },
    });
    ref.afterClose.subscribe((created) => {
      if (created) {
        // refresh не нужен — диалог уже перебрасывает на /manager/projects/{id}
      }
    });
  }
}
