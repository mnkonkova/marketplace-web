import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDropList,
  CdkDrag,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { ManagerBoardPage } from '@pages/manager/board/board.page';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';
import { BoardListViewComponent } from '@widgets/board-list-view/board-list-view.component';
import { StageMoveSheetComponent } from '@widgets/stage-move-sheet/stage-move-sheet.component';
import {
  ChangeFunnelDialog,
  ChangeFunnelDialogData,
  ChangeFunnelDialogResult,
} from '@features/change-funnel/change-funnel.dialog';

// Админский канбан — всё то же что у менеджера, но без assigned-фильтра
// и через admin endpoints (moveStage без assert-проверки).
@Component({
  selector: 'app-admin-board',
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
    AdminLayoutComponent,
    BoardListViewComponent,
    StageMoveSheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.page.html',
  styleUrl: './board.page.scss',
})
export class AdminBoardPage extends ManagerBoardPage {
  protected override loadProjects() {
    return this.projectApi.adminListProjects();
  }

  protected override moveStep(projectId: string, targetStepId: string, updatedAt?: string) {
    return this.projectApi.adminMoveStep(projectId, targetStepId, updatedAt);
  }

  // В админке открываем проект в новой вкладке, чтобы не терять контекст канбана.
  public override open(p: ProjectManagerView): void {
    window.open(`/manager/projects/${p.id}`, '_blank', 'noopener');
  }

  public openChangeFunnel(): void {
    const project = this.moveTarget();
    if (!project) return;
    this.moveSheetOpen.set(false);
    // Грузим список всех воронок (не только тех, что в boards — там только
    // активные с проектами), чтобы дать выбрать любую.
    this.pipelineApi.list().subscribe({
      next: (r) => {
        const ref = this.modal.create<
          ChangeFunnelDialog,
          ChangeFunnelDialogData,
          ChangeFunnelDialogResult | null
        >({
          nzTitle: 'Сменить воронку',
          nzContent: ChangeFunnelDialog,
          nzFooter: null,
          nzWidth: 520,
          nzClassName: 'change-funnel-modal',
          nzData: {
            projectId: project.id,
            projectTitle: project.title,
            currentPipelineId: project.pipeline_id,
            pipelines: r.items,
          },
        });
        ref.afterClose.subscribe((res: ChangeFunnelDialogResult | null | undefined) => {
          if (res?.pipelineId) this.fetch();
        });
      },
      error: () => this.msg.error('Не удалось загрузить список воронок'),
    });
  }
}
