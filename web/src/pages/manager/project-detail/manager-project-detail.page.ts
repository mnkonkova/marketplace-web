import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { formatDistanceToNow } from 'date-fns';

import { NzSelectModule } from 'ng-zorro-antd/select';

import { AdminApi, ManagerInfo } from '@entities/admin/api/admin.api';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import { ProjectApi } from '@entities/project/api/project.api';
import {
  ChangeFunnelDialog,
  ChangeFunnelDialogData,
  ChangeFunnelDialogResult,
} from '@features/change-funnel/change-funnel.dialog';
import { AssignSpecialistDialogComponent } from '@features/assign-specialist/assign-specialist.dialog';
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
import { BackLinkComponent } from '@shared/nav/back-link.component';

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
    NzSelectModule,
    NzSwitchModule,
    ManagerLayoutComponent,
    BackLinkComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-project-detail.page.html',
  styleUrl: './manager-project-detail.page.scss',
})
export class ManagerProjectDetailPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly adminApi = inject(AdminApi);

  private readonly pipelineApi = inject(PipelineApi);

  private readonly auth = inject(AuthSessionStore);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  // Список всех менеджеров (для админ-блока «Назначить менеджера»). Грузится
  // только если текущий юзер admin. Если manager — блок не показывается.
  public readonly managers = signal<ManagerInfo[]>([]);

  public readonly isAdmin = this.auth.role;

  public readonly assignedManagerId = signal<string | null>(null);

  public readonly claimBusy = signal(false);

  public get assignedManagerValue(): string {
    return this.assignedManagerId() ?? '';
  }

  public set assignedManagerValue(v: string) {
    this.assignedManagerId.set(v || null);
  }

  public assignManager(): void {
    const p = this.project();
    if (!p) return;
    this.api.adminAssignManager(p.id, this.assignedManagerId()).subscribe({
      next: () => {
        this.msg.success(this.assignedManagerId() ? 'Менеджер назначен' : 'Менеджер снят');
        this.fetch(p.id, true);
      },
      error: (e: { error?: { message?: string } }) =>
        this.msg.error(e?.error?.message || 'Не удалось назначить менеджера'),
    });
  }

  public readonly loading = signal(true);

  public readonly project = signal<ProjectFullView | null>(null);

  public readonly events = signal<ProjectEvent[]>([]);

  public readonly comments = signal<ProjectComment[]>([]);

  public readonly commentBody = signal('');

  public readonly commentInternal = signal(false);

  public readonly proposingBusy = signal(false);

  public readonly cancelBusy = signal(false);

  public claimProject(): void {
    const p = this.project();
    if (!p) return;
    this.claimBusy.set(true);
    this.api.managerClaim(p.id).subscribe({
      next: () => {
        this.claimBusy.set(false);
        this.msg.success('Проект взят');
        this.fetch(p.id);
      },
      error: (e: { error?: { error?: string } }) => {
        this.claimBusy.set(false);
        if (e?.error?.error === 'already_claimed') {
          this.msg.warning('Уже взят другим менеджером');
          this.fetch(p.id);
        } else {
          this.msg.error('Не удалось взять проект');
        }
      },
    });
  }

  public openChangeFunnel(): void {
    const p = this.project();
    if (!p) return;
    this.pipelineApi.list().subscribe({
      next: (r) => {
        const ref = this.modal.create<
          ChangeFunnelDialog,
          ChangeFunnelDialogData,
          ChangeFunnelDialogResult | null
        >({
          nzTitle: 'Сменить воронку',
          nzContent: ChangeFunnelDialog,
          nzFooter: null,
          nzWidth: 520,
          nzClassName: 'change-funnel-modal',
          nzData: {
            projectId: p.id,
            projectTitle: p.title,
            currentPipelineId: p.pipeline_id,
            pipelines: r.items,
          },
        });
        ref.afterClose.subscribe((res: ChangeFunnelDialogResult | null | undefined) => {
          if (res?.pipelineId) this.fetch(p.id);
        });
      },
      error: () => this.msg.error('Не удалось загрузить список воронок'),
    });
  }

  public cancelProject(): void {
    const p = this.project();
    if (!p) return;
    const ok = window.confirm(
      `Удалить проект «${p.title}»?\n\nОн исчезнет из списков и канбана сразу. ` +
        `Физически удалится из БД через 30 дней (данные ещё можно восстановить SQL-ом).`,
    );
    if (!ok) return;
    const reason = window.prompt('Причина (для лога активности, можно пропустить):') ?? '';
    this.cancelBusy.set(true);
    this.api.adminCancelProject(p.id, reason).subscribe({
      next: () => {
        this.cancelBusy.set(false);
        this.msg.success('Проект удалён');
        void this.router.navigate(['/admin/projects']);
      },
      error: (e: { error?: { message?: string } }) => {
        this.cancelBusy.set(false);
        this.msg.error(e?.error?.message || 'Не удалось удалить');
      },
    });
  }

  public approveProposed(): void {
    const p = this.project();
    if (!p) return;
    this.proposingBusy.set(true);
    this.api.managerApproveSpecialist(p.id).subscribe({
      next: () => {
        this.proposingBusy.set(false);
        this.msg.success('Исполнитель подтверждён');
        this.fetch(p.id, true);
      },
      error: (e: { error?: { error?: string; message?: string } }) => {
        this.proposingBusy.set(false);
        this.msg.error(e?.error?.message || 'Не удалось подтвердить');
      },
    });
  }

  public rejectProposed(): void {
    const p = this.project();
    if (!p) return;
    const reason = window.prompt('Причина отклонения (необязательно):') ?? '';
    this.proposingBusy.set(true);
    this.api.managerRejectSpecialist(p.id, reason).subscribe({
      next: () => {
        this.proposingBusy.set(false);
        this.msg.success('Предложение отклонено');
        this.fetch(p.id, true);
      },
      error: (e: { error?: { error?: string; message?: string } }) => {
        this.proposingBusy.set(false);
        this.msg.error(e?.error?.message || 'Не удалось отклонить');
      },
    });
  }

  public openAssignSpecialist(): void {
    const p = this.project();
    if (!p) return;
    const ref = this.modal.create({
      nzTitle: 'Назначить специалиста',
      nzContent: AssignSpecialistDialogComponent,
      nzFooter: null,
      nzWidth: 480,
      nzData: { mode: 'manager', projectID: p.id },
    });
    ref.afterClose.subscribe((assigned) => {
      if (assigned) this.fetch(p.id, true);
    });
  }

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
    const internal = this.commentInternal();
    this.api.managerCreateComment(p.id, body, internal).subscribe({
      next: () => {
        this.commentBody.set('');
        this.commentInternal.set(false);
        this.fetch(p.id, true);
      },
      error: () => this.msg.error('Не удалось отправить'),
    });
  }

  public get commentInternalValue(): boolean {
    return this.commentInternal();
  }

  public set commentInternalValue(v: boolean) {
    this.commentInternal.set(v);
  }

  // Telegram-хэндл может быть `@user` или просто `user` — нормализуем в https-ссылку.
  public tgLink(handle: string): string {
    const h = handle.replace(/^@/, '').trim();
    return `https://t.me/${h}`;
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
        this.assignedManagerId.set(p.assigned_to_user_id ?? null);
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
    // Только админ может назначать менеджера. Грузим список разово.
    if (this.isAdmin() === 'admin' && this.managers().length === 0) {
      this.adminApi.listManagers(true).subscribe({
        next: (r) => this.managers.set(r.items),
      });
    }
  }
}
