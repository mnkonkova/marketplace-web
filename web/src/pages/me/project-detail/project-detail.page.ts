import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import {
  ProjectClientView,
  ProjectComment,
  ProjectStepView,
} from '@entities/project/model/project.types';
import {
  OWNER_LABEL,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  STAGE_STATUS_COLOR,
  STAGE_STATUS_LABEL,
  getStepBadge,
} from '@shared/lib/project-status';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-project-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzCardModule,
    NzTagModule,
    NzProgressModule,
    NzSpinModule,
    NzButtonModule,
    NzInputModule,
    NzIconModule,
    RouterLink,
    AppHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-detail.page.html',
  styleUrl: './project-detail.page.scss',
})
export class ProjectDetailPage implements OnDestroy {
  private readonly api = inject(ProjectApi);

  private readonly route = inject(ActivatedRoute);

  private readonly msg = inject(NzMessageService);

  private pollSub?: Subscription;

  public readonly loading = signal(true);

  public readonly project = signal<ProjectClientView | null>(null);

  public readonly busy = signal<string | null>(null);

  public readonly comments = signal<ProjectComment[]>([]);

  public readonly newComment = signal('');

  public get newCommentValue(): string {
    return this.newComment();
  }

  public set newCommentValue(v: string) {
    this.newComment.set(v);
  }

  public sendComment(): void {
    const p = this.project();
    const body = this.newComment().trim();
    if (!p || !body) return;
    this.api.clientCreateComment(p.id, body).subscribe({
      next: () => {
        this.newComment.set('');
        this.api.clientListComments(p.id).subscribe((r) => this.comments.set(r.items));
      },
      error: () => this.msg.error('Не удалось отправить'),
    });
  }

  public projectStatusLabel(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public projectStatusColor(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public stageStatusLabel(s: ProjectClientView['stages'][number]['display_status']): string {
    return STAGE_STATUS_LABEL[s];
  }

  public stageStatusColor(s: ProjectClientView['stages'][number]['display_status']): string {
    return STAGE_STATUS_COLOR[s];
  }

  public ownerLabel(o: ProjectStepView['owner']): string {
    return OWNER_LABEL[o];
  }

  public constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.fetch(id);
      this.pollSub = interval(30_000).subscribe(() => this.fetch(id, true));
    }
  }

  public ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  public stepBadge(step: ProjectStepView) {
    return getStepBadge(step.status, step.owner);
  }

  public canSubmitReview(step: ProjectStepView): boolean {
    return (
      step.status === 'waiting_client' && step.owner === 'client' && step.is_review
    );
  }

  public submitReview(step: ProjectStepView): void {
    const p = this.project();
    if (!p) return;
    this.busy.set(step.id);
    this.api.clientSubmitReview(p.id, step.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.msg.success('Отзыв засчитан');
        this.fetch(p.id, true);
      },
      error: () => {
        this.busy.set(null);
        this.msg.error('Не удалось засчитать отзыв');
      },
    });
  }

  private fetch(id: string, quiet = false): void {
    if (!quiet) this.loading.set(true);
    this.api.getClientFunnel(id).subscribe({
      next: (p) => {
        this.project.set(p);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.clientListComments(id).subscribe({
      next: (r) => this.comments.set(r.items),
    });
  }
}
