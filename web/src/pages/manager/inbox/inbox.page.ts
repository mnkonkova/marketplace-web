import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { ManagerLayoutComponent } from '@widgets/manager-layout/manager-layout.component';

@Component({
  selector: 'app-manager-inbox',
  standalone: true,
  imports: [
    CommonModule,
    NzCardModule,
    NzTagModule,
    NzButtonModule,
    NzSpinModule,
    NzEmptyModule,
    ManagerLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inbox.page.html',
  styleUrl: './inbox.page.scss',
})
export class ManagerInboxPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly projects = signal<ProjectManagerView[]>([]);

  public readonly claiming = signal<string | null>(null);

  public ngOnInit(): void {
    this.fetch();
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public claim(p: ProjectManagerView): void {
    this.claiming.set(p.id);
    this.api.managerClaim(p.id).subscribe({
      next: () => {
        this.claiming.set(null);
        this.msg.success('Проект взят');
        void this.router.navigate(['/manager/board']);
      },
      error: (e) => {
        this.claiming.set(null);
        if (e?.error?.error === 'already_claimed') {
          this.msg.warning('Уже взят другим менеджером');
          this.fetch();
        } else {
          this.msg.error('Не удалось взять проект');
        }
      },
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.api.managerInbox().subscribe({
      next: (r) => {
        this.projects.set(r.items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
