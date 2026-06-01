import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzProgressModule } from 'ng-zorro-antd/progress';

import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

@Component({
  selector: 'app-admin-projects-list',
  standalone: true,
  imports: [
    CommonModule,
    NzTableModule,
    NzTagModule,
    NzProgressModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-list.page.html',
  styleUrl: './projects-list.page.scss',
})
export class AdminProjectsListPage implements OnInit {
  private readonly api = inject(ProjectApi);

  public readonly items = signal<ProjectManagerView[]>([]);

  public ngOnInit(): void {
    this.api.adminListProjects().subscribe((r) => this.items.set(r.items));
  }

  public open(p: ProjectManagerView): void {
    window.open(`/manager/projects/${p.id}`, '_blank', 'noopener');
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }
}
