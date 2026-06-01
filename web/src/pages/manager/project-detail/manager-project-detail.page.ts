import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { formatDistanceToNow } from 'date-fns';

import { ProjectApi } from '@entities/project/api/project.api';
import {
  ProjectComment,
  ProjectEvent,
  ProjectFullView,
  ProjectStepView,
} from '@entities/project/model/project.types';
import {
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  STAGE_STATUS_COLOR,
  STAGE_STATUS_LABEL,
  getStepBadge,
} from '@shared/lib/project-status';
import { ManagerLayoutComponent } from '@widgets/manager-layout/manager-layout.component';

@Component({
  selector: 'app-manager-project-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzSpinModule,
    NzTagModule,
    NzButtonModule,
    NzInputModule,
    NzProgressModule,
    NzModalModule,
    ManagerLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-project-detail.page.html',
  styleUrl: './manager-project-detail.page.scss',
})
export class ManagerProjectDetailPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly route = inject(ActivatedRoute);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  public readonly loading = signal(true);

  public readonly project = signal<ProjectFullView | null>(null);

  public readonly events = signal<ProjectEvent[]>([]);

  public readonly comments = signal<ProjectComment[]>([]);

  public readonly commentBody = signal('');

  public readonly skipComment = signal('');

  public readonly busy = signal<string | null>(null);

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.fetch(id);
  }

  public stepBadge(s: ProjectStepView) {
    return getStepBadge(s.status, s.owner);
  }

  public statusLabel(s: ProjectFullView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusColor(s: ProjectFullView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public stageStatusLabel(s: ProjectFullView['stages'][number]['display_status']): string {
    return STAGE_STATUS_LABEL[s];
  }

  public stageStatusColor(s: ProjectFullView['stages'][number]['display_status']): string {
    return STAGE_STATUS_COLOR[s];
  }

  public ago(iso: string): string {
    try {
      return formatDistanceToNow(new Date(iso), { addSuffix: true });
    } catch {
      return iso;
    }
  }

  public canStart(s: ProjectStepView): boolean {
    return s.status === 'pending';
  }

  public canComplete(s: ProjectStepView): boolean {
    return s.status === 'in_progress' && (s.owner === 'team' || s.owner === 'system');
  }

  public start(s: ProjectStepView): void {
    const p = this.project();
    if (!p) return;
    this.busy.set(s.id);
    this.api.managerStartStep(p.id, s.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.fetch(p.id, true);
      },
      error: () => {
        this.busy.set(null);
        this.msg.error('Не удалось стартовать');
      },
    });
  }

  public complete(s: ProjectStepView): void {
    const p = this.project();
    if (!p) return;
    this.busy.set(s.id);
    this.api.managerCompleteStep(p.id, s.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.fetch(p.id, true);
      },
      error: () => {
        this.busy.set(null);
        this.msg.error('Не удалось завершить');
      },
    });
  }

  public skip(s: ProjectStepView, tpl: unknown): void {
    const p = this.project();
    if (!p) return;
    this.skipComment.set('');
    this.modal.create({
      nzTitle: 'Пропустить шаг',
      nzContent: tpl as never,
      nzOnOk: () => {
        const comment = this.skipComment().trim();
        if (!comment) {
          this.msg.warning('Комментарий обязателен');
          return false;
        }
        this.busy.set(s.id);
        this.api.managerSkipStep(p.id, s.id, comment).subscribe({
          next: () => {
            this.busy.set(null);
            this.fetch(p.id, true);
          },
          error: () => {
            this.busy.set(null);
            this.msg.error('Не удалось пропустить');
          },
        });
        return true;
      },
    });
  }

  public sendComment(): void {
    const p = this.project();
    const body = this.commentBody().trim();
    if (!p || !body) return;
    this.api.managerCreateComment(p.id, body).subscribe({
      next: () => {
        this.commentBody.set('');
        this.fetch(p.id, true);
      },
      error: () => this.msg.error('Не удалось отправить'),
    });
  }

  // Двусторонняя привязка ngModel ↔ signal.
  public get commentBodyValue(): string {
    return this.commentBody();
  }

  public set commentBodyValue(v: string) {
    this.commentBody.set(v);
  }

  public get skipCommentValue(): string {
    return this.skipComment();
  }

  public set skipCommentValue(v: string) {
    this.skipComment.set(v);
  }

  private fetch(id: string, quiet = false): void {
    if (!quiet) this.loading.set(true);
    this.api.managerGetFull(id).subscribe({
      next: (p) => {
        this.project.set(p);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.managerListEvents(id).subscribe({
      next: (r) => this.events.set(r.items),
    });
    this.api.managerListComments(id).subscribe({
      next: (r) => this.comments.set(r.items),
    });
  }
}
