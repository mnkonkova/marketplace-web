import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzEmptyModule } from 'ng-zorro-antd/empty';

import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectClientView } from '@entities/project/model/project.types';
import {
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from '@shared/lib/project-status';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-projects-list-page',
  standalone: true,
  imports: [
    CommonModule,
    NzCardModule,
    NzTagModule,
    NzProgressModule,
    NzSpinModule,
    NzEmptyModule,
    AppHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-list.page.html',
  styleUrl: './projects-list.page.scss',
})
export class ProjectsListPage {
  private readonly api = inject(ProjectApi);

  private readonly router = inject(Router);

  public readonly loading = signal(true);

  public readonly projects = signal<ProjectClientView[]>([]);

  public label(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public color(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public constructor() {
    this.api.listClientProjects().subscribe({
      next: (resp) => {
        this.projects.set(resp.items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  public open(p: ProjectClientView): void {
    void this.router.navigate(['/me/projects', p.id]);
  }
}
