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
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import {
  ProjectClientView,
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
    NzModalModule,
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

  private readonly modal = inject(NzModalService);

  private readonly msg = inject(NzMessageService);

  private pollSub?: Subscription;

  public readonly loading = signal(true);

  public readonly project = signal<ProjectClientView | null>(null);

  public readonly busy = signal<string | null>(null);

  public readonly revisionComment = signal('');

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

  public canApprove(step: ProjectStepView): boolean {
    return (
      step.status === 'waiting_client' && step.owner === 'client' && !step.is_review
    );
  }

  public canSubmitReview(step: ProjectStepView): boolean {
    return (
      step.status === 'waiting_client' && step.owner === 'client' && step.is_review
    );
  }

  public approve(step: ProjectStepView): void {
    const p = this.project();
    if (!p) return;
    this.busy.set(step.id);
    this.api.clientApprove(p.id, step.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.msg.success('Шаг принят');
        this.fetch(p.id, true);
      },
      error: () => {
        this.busy.set(null);
        this.msg.error('Не удалось принять шаг');
      },
    });
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

  public requestRevision(step: ProjectStepView, modalContent: unknown): void {
    const p = this.project();
    if (!p) return;
    this.revisionComment.set('');
    this.modal.create({
      nzTitle: 'Запросить правки',
      nzContent: modalContent as never,
      nzOnOk: () => {
        const comment = this.revisionComment().trim();
        this.busy.set(step.id);
        this.api.clientRequestRevision(p.id, step.id, comment).subscribe({
          next: () => {
            this.busy.set(null);
            this.msg.success('Заявка на правки отправлена');
            this.fetch(p.id, true);
          },
          error: (e) => {
            this.busy.set(null);
            const code = e?.error?.error as string | undefined;
            if (code === 'revisions_exhausted') {
              this.msg.warning('Лимит правок исчерпан, дело передано менеджеру');
            } else {
              this.msg.error('Не удалось запросить правки');
            }
            this.fetch(p.id, true);
          },
        });
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
  }
}
