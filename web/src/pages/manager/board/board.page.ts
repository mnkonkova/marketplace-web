import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { PipelineFull } from '@entities/pipeline/model/pipeline.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { ManagerLayoutComponent } from '@widgets/manager-layout/manager-layout.component';

interface BoardColumn {
  stage_id: string;
  name: string;
  sort_order: number;
  items: ProjectManagerView[];
  // Группировка карточек по шагам внутри стадии: name шага → массив проектов
  // у которых current_step_title == name. Используется в шаблоне для
  // подсекций. Если у стадии один шаг — секции схлопываются в основной список.
  stepGroups: { name: string; items: ProjectManagerView[] }[];
}

interface BoardForPipeline {
  pipeline: PipelineFull;
  columns: BoardColumn[];
}

@Component({
  selector: 'app-manager-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    NzSpinModule,
    NzTagModule,
    NzEmptyModule,
    NzSelectModule,
    ManagerLayoutComponent,
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

  public readonly loading = signal(true);

  public readonly boards = signal<BoardForPipeline[]>([]);

  public readonly selectedPipelineId = signal<string>('');

  public readonly currentBoard = computed(
    () => this.boards().find((b) => b.pipeline.id === this.selectedPipelineId()) ?? null,
  );

  public ngOnInit(): void {
    this.fetch();
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public open(p: ProjectManagerView): void {
    void this.router.navigate(['/manager/projects', p.id]);
  }

  // onDrop — переносим проект на любую колонку выбранной воронки.
  // Бэк сам разруливает: вперёд с проверкой client-шагов, назад с
  // ресетом стадий. При 409 stage_blocked — откатываем перенос.
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

    // На бэк уходит pipeline_stage_id (из шаблона). Бэк сам разруливает
    // через MoveProjectToStage: находит соответствующий project_stage по
    // sort_order или по прямому маппингу. Подождём пока бэк не будет
    // принимать pipeline_stage_id — сейчас используем project_stage_id из
    // снапшота, который мы НЕ знаем. Решение: бэк должен принимать
    // pipeline_stage_id — а в MoveProjectToStage по sort_order находить
    // соответствующий project_stage.
    // updated_at прокидываем для optimistic-lock — если другой менеджер
    // успел сдвинуть проект между нашим load и drop, бэк вернёт 409
    // stale_updated_at, мы покажем тост и откатим.
    this.moveStage(project.id, targetCol.stage_id, project.updated_at).subscribe({
      next: (updated) => {
        Object.assign(project, {
          current_stage_order: targetCol.sort_order,
          current_stage_name: targetCol.name,
          current_step_id: updated.current_step_id,
          current_step_title: updated.current_step_title,
          current_step_status: updated.current_step_status,
          display_status: updated.display_status,
          updated_at: updated.updated_at,
        });
        this.msg.success('Стадия обновлена');
      },
      error: (e) => {
        // откат
        transferArrayItem(
          event.container.data,
          event.previousContainer.data,
          event.currentIndex,
          event.previousIndex,
        );
        this.boards.set([...this.boards()]);
        const code = e?.error?.error as string | undefined;
        if (code === 'stage_blocked') {
          this.msg.warning('Нельзя двигать вперёд — ожидается действие клиента');
        } else if (code === 'stale_updated_at') {
          this.msg.warning('Проект уже обновили — перезагрузите страницу');
          this.fetch();
        } else if (code === 'not_found') {
          this.msg.error('Стадия не найдена');
        } else {
          this.msg.error('Не удалось перенести');
        }
      },
    });
  }

  // Перегружаемое — admin board использует adminMoveStage.
  protected moveStage(projectId: string, targetStageId: string, updatedAt?: string) {
    return this.projectApi.managerMoveStage(projectId, targetStageId, updatedAt);
  }

  protected loadProjects() {
    return this.projectApi.managerAssigned();
  }

  // Двусторонняя привязка nz-select.
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
              // Группируем по sort_order: project.current_stage_id —
              // это snapshot из project_stages, в pipeline.stages — шаблонные id.
              // Сравниваем по порядковому номеру стадии в воронке.
              const cols: BoardColumn[] = pl.stages
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((st) => {
                  const items = projects.filter(
                    (p) => p.current_stage_order === st.sort_order,
                  );
                  // Группировка по current_step_title внутри стадии.
                  // Pipeline.stages[].steps уже отсортированы по sort_order
                  // (бэк гарантирует). Берём шаги стадии — каждый = подсекция.
                  const stepsSorted = (st.steps ?? [])
                    .slice()
                    .sort((a, b) => a.sort_order - b.sort_order);
                  const stepGroups = stepsSorted.map((s) => ({
                    name: s.name,
                    items: items.filter((p) => p.current_step_title === s.name),
                  }));
                  return {
                    stage_id: st.id,
                    name: st.name,
                    sort_order: st.sort_order,
                    items,
                    stepGroups,
                  };
                });
              return { pipeline: pl, columns: cols };
            });
            this.boards.set(boards);
            // Сохраняем выбор если он есть в новых данных, иначе первая
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
}
