import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { formatDistanceToNow } from 'date-fns';

import { NzSelectModule } from 'ng-zorro-antd/select';

import { AdminApi, ManagerInfo } from '@entities/admin/api/admin.api';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { ProjectApi } from '@entities/project/api/project.api';
import { AssignSpecialistDialogComponent } from '@features/assign-specialist/assign-specialist.dialog';
import {
  ProjectEvent,
  ProjectFullView,
  ProjectStepView,
} from '@entities/project/model/project.types';
import {
  PROJECT_KIND_LABEL,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  STAGE_STATUS_COLOR,
  STAGE_STATUS_LABEL,
  getStepBadge,
} from '@shared/lib/project-status';
import { ManagerLayoutComponent } from '@widgets/manager-layout/manager-layout.component';
import { ManagerTurnkeyProjectComponent } from '@widgets/manager-turnkey-project/manager-turnkey-project.component';
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';
import { ProjectMaterialsComponent } from '@widgets/project-materials/project-materials.component';
import { ProjectPublicationsComponent } from '@widgets/project-publications/project-publications.component';
import { BackLinkComponent } from '@shared/nav/back-link.component';
import { AdminCrumb, AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

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
    NgTemplateOutlet,
    AdminLayoutComponent,
    ManagerLayoutComponent,
    BackLinkComponent,
    ManagerTurnkeyProjectComponent,
    ProjectCommentsComponent,
    ProjectMaterialsComponent,
    ProjectPublicationsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-project-detail.page.html',
  styleUrl: './manager-project-detail.page.scss',
})
export class ManagerProjectDetailPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly adminApi = inject(AdminApi);

  private readonly auth = inject(AuthSessionStore);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  // Список всех менеджеров (для админ-блока «Назначить менеджера»). Грузится
  // только если текущий юзер admin. Если manager — блок не показывается.
  public readonly managers = signal<ManagerInfo[]>([]);

  public readonly isAdmin = this.auth.role;

  // Свой id — чтобы в переписке свои сообщения были подписаны «Вы».
  public readonly meId = this.auth.userId;

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

  // Меню «⋯» у названия проекта. Удаление лежит здесь, а не кнопкой в
  // тулбаре: оно необратимо и стояло вплотную к «Применить» — промах в
  // один сантиметр стоил проекта.
  public readonly menuOpen = signal(false);

  public readonly deleteConfirm = signal('');

  public readonly deleteReason = signal('');

  public get deleteConfirmValue(): string {
    return this.deleteConfirm();
  }

  public set deleteConfirmValue(v: string) {
    this.deleteConfirm.set(v);
  }

  public get deleteReasonValue(): string {
    return this.deleteReason();
  }

  public set deleteReasonValue(v: string) {
    this.deleteReason.set(v);
  }

  public toggleMenu(): void {
    this.menuOpen.set(!this.menuOpen());
  }

  public closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * Подтверждение удаления — вводом названия проекта.
   *
   * «Да/нет» здесь не годится: диалог с одной кнопкой подтверждается
   * рефлекторно, а проект уходит из всех списков сразу и возвращается
   * только SQL-ом. Набранное название заставляет посмотреть, какой именно
   * проект удаляешь.
   */
  public askDelete(tpl: unknown): void {
    const p = this.project();
    if (!p) return;
    this.menuOpen.set(false);
    this.deleteConfirm.set('');
    this.deleteReason.set('');
    this.modal.create({
      nzTitle: 'Удалить проект',
      nzContent: tpl as never,
      nzOkText: 'Удалить',
      nzOkDanger: true,
      nzOnOk: () =>
        new Promise<boolean>((resolve) => {
          if (this.deleteConfirm().trim() !== p.title) {
            this.msg.warning('Название не совпадает — проект остался на месте');
            resolve(false);
            return;
          }
          this.cancelBusy.set(true);
          this.api.adminCancelProject(p.id, this.deleteReason().trim()).subscribe({
            next: () => {
              this.cancelBusy.set(false);
              this.msg.success('Проект удалён');
              void this.router.navigate(['/admin/projects']);
              resolve(true);
            },
            error: (e: { error?: { message?: string } }) => {
              this.cancelBusy.set(false);
              this.msg.error(e?.error?.message || 'Не удалось удалить');
              resolve(false);
            },
          });
        }),
    });
  }

  // Крошки вместо пилюли «Ко всем проектам» отдельной строкой: та занимала
  // строку экрана, чтобы сказать то же самое одним словом меньше.
  public readonly crumbs = computed<AdminCrumb[]>(() => [
    { label: 'Проекты', link: '/admin/projects' },
    { label: this.project()?.title ?? 'Проект' },
  ]);

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

  public kindLabel(k: ProjectFullView['kind']): string {
    return PROJECT_KIND_LABEL[k] ?? k;
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

  // Telegram-хэндл может быть `@user` или просто `user` — нормализуем в https-ссылку.
  public tgLink(handle: string): string {
    const h = handle.replace(/^@/, '').trim();
    return `https://t.me/${h}`;
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
    // Только админ может назначать менеджера. Грузим список разово.
    if (this.isAdmin() === 'admin' && this.managers().length === 0) {
      this.adminApi.listManagers(true).subscribe({
        next: (r) => this.managers.set(r.items),
      });
    }
  }
}
