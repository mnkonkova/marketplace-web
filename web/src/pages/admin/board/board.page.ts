import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
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
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

interface BoardColumn {
  id: string;
  name: string;
  order: number;
  items: ProjectManagerView[];
}

// Канбан админа — то же что у менеджера, но без фильтра по assigned_to=me.
// (Уточнение брифа: «админ видит все проекты на своём канбане».)
@Component({
  selector: 'app-admin-board',
  standalone: true,
  imports: [
    CommonModule,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    NzSpinModule,
    NzTagModule,
    NzEmptyModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.page.html',
  styleUrl: './board.page.scss',
})
export class AdminBoardPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly columns = signal<BoardColumn[]>([]);

  public ngOnInit(): void {
    this.fetch();
  }

  public open(p: ProjectManagerView): void {
    void this.router.navigate(['/manager/projects', p.id]);
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public onDrop(event: CdkDragDrop<ProjectManagerView[]>, targetCol: BoardColumn): void {
    if (event.previousContainer === event.container) return;
    const project = event.item.data as ProjectManagerView;
    const sourceCol = this.columns().find((c) => c.items.includes(project));
    if (!sourceCol) return;
    if (targetCol.order !== sourceCol.order + 1) {
      this.msg.warning('Можно двигать только на следующую стадию');
      return;
    }
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );
    this.columns.set([...this.columns()]);
    this.api.adminAdvanceStage(project.id).subscribe({
      next: () => this.msg.success('Стадия продвинута'),
      error: (e) => {
        transferArrayItem(
          event.container.data,
          event.previousContainer.data,
          event.currentIndex,
          event.previousIndex,
        );
        this.columns.set([...this.columns()]);
        if (e?.error?.error === 'stage_blocked') {
          this.msg.warning('Ожидается действие клиента — пропустить нельзя');
        } else if (e?.error?.error === 'last_stage') {
          this.msg.info('Проект уже на последней стадии');
        } else {
          this.msg.error('Не удалось продвинуть стадию');
        }
      },
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.api.adminListProjects().subscribe({
      next: (r) => {
        this.columns.set(this.groupByStage(r.items));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private groupByStage(items: ProjectManagerView[]): BoardColumn[] {
    const map = new Map<string, BoardColumn>();
    for (const p of items) {
      const id = p.current_stage_id ?? 'none';
      const name = p.current_stage_name ?? 'Без стадии';
      const order = p.current_stage_order ?? 0;
      if (!map.has(id)) {
        map.set(id, { id, name, order, items: [] });
      }
      map.get(id)!.items.push(p);
    }
    return Array.from(map.values()).sort((a, b) => a.order - b.order);
  }
}
