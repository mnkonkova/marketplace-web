import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDropList,
  CdkDrag,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { ManagerBoardPage } from '@pages/manager/board/board.page';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

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
    NzSpinModule,
    NzTagModule,
    NzEmptyModule,
    NzSelectModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.page.html',
  styleUrl: './board.page.scss',
})
export class AdminBoardPage extends ManagerBoardPage {
  protected override loadProjects() {
    return this.projectApi.adminListProjects();
  }

  protected override moveStage(projectId: string, targetStageId: string, updatedAt?: string) {
    return this.projectApi.adminMoveStage(projectId, targetStageId, updatedAt);
  }
}
