import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '@shared/lib/project-status';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';
import { CrmShellStore } from '@widgets/crm-layout/crm-shell.store';

@Component({
  selector: 'app-manager-inbox',
  standalone: true,
  imports: [
    CommonModule,
    NzCardModule,
    NzButtonModule,
    ListStateComponent,
    PageHeadComponent,
    StatusTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inbox.page.html',
  styleUrl: './inbox.page.scss',
})
export class ManagerInboxPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  private readonly shell = inject(CrmShellStore);

  public readonly loading = signal(true);

  /**
   * Ошибка загрузки — отдельно от пустого списка. Прежде их не различали:
   * упавшая ручка выглядела как «все проекты разобраны», и человек уходил
   * с экрана довольным.
   */
  public readonly error = signal<string | null>(null);

  public readonly projects = signal<ProjectManagerView[]>([]);

  public readonly claiming = signal<string | null>(null);

  public ngOnInit(): void {
    this.fetch();
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusTone(s: ProjectManagerView['display_status']): StatusTone {
    return PROJECT_STATUS_TONE[s];
  }

  public claim(p: ProjectManagerView): void {
    this.claiming.set(p.id);
    this.api.managerClaim(p.id).subscribe({
      next: () => {
        this.claiming.set(null);
        this.msg.success('Проект взят');
        void this.router.navigate(['/manager/projects', p.id]);
      },
      error: (e) => {
        this.claiming.set(null);
        if (e?.error?.error === 'already_claimed') {
          this.msg.warning('Уже взят другим менеджером');
          this.fetch();
        } else {
          this.msg.error(parseApiError(e, 'Не удалось взять проект').message);
        }
      },
    });
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.managerInbox().subscribe({
      next: (r) => {
        this.projects.set(r.items);
        // Бейдж «Входящих» в сайдбаре считается отсюда: оболочка живёт
        // дольше страницы, и просить тот же список второй раз ради одной
        // цифры было бы платой ни за что.
        this.shell.setInboxCount(r.items.length);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить входящие.').message);
      },
    });
  }
}
