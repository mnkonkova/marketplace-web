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
import { NzRateModule } from 'ng-zorro-antd/rate';
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
    NzRateModule,
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

  // ID review-шага, по которому открыта inline-форма (rating + text).
  // null = форма закрыта. Открыть может только один шаг одновременно.
  public readonly openReviewStepID = signal<string | null>(null);

  // Локальный state формы. Сбрасывается при открытии/закрытии.
  public reviewRating = 5;
  public reviewText = '';

  public openReviewForm(step: ProjectStepView): void {
    this.openReviewStepID.set(step.id);
    this.reviewRating = 5;
    this.reviewText = '';
  }

  public cancelReviewForm(): void {
    this.openReviewStepID.set(null);
  }

  // Сабмит отзыва: создаём reviews-запись (rating + text) → дёргаем
  // submit_review чтобы закрыть шаг. Если первый шаг упал — второй
  // тоже не дёргаем (иначе шаг закроется без отзыва, а это инвалид).
  public confirmReview(step: ProjectStepView): void {
    const p = this.project();
    if (!p || !p.specialist_user_id) {
      this.msg.error('Исполнитель ещё не назначен — отзыв оставить нельзя.');
      return;
    }
    const text = (this.reviewText || '').trim();
    if (text.length < 3) {
      this.msg.error('Напишите хотя бы пару слов отзыва.');
      return;
    }
    if (this.reviewRating < 1 || this.reviewRating > 5) {
      this.msg.error('Выберите оценку от 1 до 5.');
      return;
    }
    this.busy.set(step.id);
    this.api
      .createReview({
        lead_id: p.lead_id,
        target_user_id: p.specialist_user_id,
        rating: this.reviewRating,
        text,
      })
      .subscribe({
        next: () => {
          this.api.clientSubmitReview(p.id, step.id).subscribe({
            next: () => {
              this.busy.set(null);
              this.openReviewStepID.set(null);
              this.msg.success('Отзыв отправлен');
              this.fetch(p.id, true);
            },
            error: () => {
              this.busy.set(null);
              this.msg.error(
                'Отзыв сохранён, но шаг не закрылся — обновите страницу.',
              );
            },
          });
        },
        error: (e) => {
          this.busy.set(null);
          // Бек возвращает {error: code, message: ...}. Сначала message
          // (если есть), иначе мап по code, иначе generic. Раньше всегда
          // был generic — UX страдал: «не могу понять, что не так».
          const status = e?.status as number | undefined;
          const msg = e?.error?.message as string | undefined;
          const code = e?.error?.error as string | undefined;
          if (status === 429) {
            this.msg.error('Слишком часто. Подождите минуту и попробуйте снова.');
          } else if (msg) {
            this.msg.error(msg);
          } else if (code === 'lead_does_not_authorize') {
            this.msg.error('Отзыв запрещён — лид не подтверждает право.');
          } else if (code === 'invalid_input') {
            this.msg.error('Не вышло сохранить — проверьте оценку и текст.');
          } else if (status === 401) {
            this.msg.error('Сессия истекла — войдите заново.');
          } else if (status === 500) {
            this.msg.error('Внутренняя ошибка сервера. Попробуйте позже.');
          } else {
            this.msg.error(`Не удалось отправить отзыв (код ${status ?? '?'}).`);
          }
        },
      });
  }

  // Старый метод оставляем для совместимости — закрывает шаг без отзыва.
  // Сейчас из template'а не вызывается (заменён на confirmReview через
  // openReviewForm), но если где-то остался — продолжит работать.
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
