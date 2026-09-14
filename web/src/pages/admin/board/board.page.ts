import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDropList, CdkDrag, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { ManagerBoardPage } from '@pages/manager/board/board.page';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';
import { BoardListViewComponent } from '@widgets/board-list-view/board-list-view.component';
import { StageMoveSheetComponent } from '@widgets/stage-move-sheet/stage-move-sheet.component';

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
    // Доску нельзя собрать по странице: карточки раскладываются по всем
    // этапам сразу, и двадцать первых строк дали бы половину колонок
    // пустыми. Просим весь набор явно — потолок ручки тот же, что был у
    // неё до появления пагинации.
    return this.projectApi.adminListProjects({ limit: 1000 });
  }

  protected override moveStep(projectId: string, targetStepId: string, updatedAt?: string) {
    return this.projectApi.adminMoveStep(projectId, targetStepId, updatedAt);
  }
}
