import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { AdminApi, ModerationSpecialistDetail } from '@entities/admin/api/admin.api';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

@Component({
  selector: 'app-admin-moderation-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzAvatarModule,
    NzTagModule,
    NzModalModule,
    NzInputModule,
    NzSpinModule,
    NzAlertModule,
    NzIconModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './moderation-detail.page.html',
  styleUrl: './moderation-detail.page.scss',
})
export class AdminModerationDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly api = inject(AdminApi);

  private readonly modal = inject(NzModalService);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly profile = signal<ModerationSpecialistDetail | null>(null);

  public readonly busy = signal(false);

  public rejectReason = '';

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!id) {
      void this.router.navigate(['/admin/moderation']);
      return;
    }
    this.api.getSpecialistForModeration(id).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.msg.error('Не удалось загрузить профиль');
      },
    });
  }

  public approve(): void {
    const p = this.profile();
    if (!p) return;
    this.busy.set(true);
    this.api.approveSpecialist(p.user_id, p.updated_at).subscribe({
      next: () => {
        this.busy.set(false);
        this.msg.success('Профиль одобрен и попадёт в каталог в течение минуты.');
        void this.router.navigate(['/admin/moderation']);
      },
      error: (e: { status?: number; error?: { error?: string; message?: string } }) => {
        this.busy.set(false);
        if (e?.status === 409) {
          this.msg.warning('Специалист отредактировал профиль — перезагрузите карточку.');
        } else {
          this.msg.error(e?.error?.message || 'Не удалось одобрить');
        }
      },
    });
  }

  public openReject(tplRef: unknown): void {
    this.rejectReason = '';
    this.modal.create({
      nzTitle: 'Отклонить публикацию',
      nzContent: tplRef as never,
      nzOkText: 'Отклонить',
      nzOkDanger: true,
      nzOkDisabled: false,
      nzOnOk: () => this.submitReject(),
    });
  }

  public submitReject(): boolean | Promise<boolean> {
    const p = this.profile();
    if (!p) return false;
    const reason = this.rejectReason.trim();
    if (reason.length < 3) {
      this.msg.warning('Опишите причину минимум 3 символами.');
      return false;
    }
    return new Promise<boolean>((resolve) => {
      this.api.rejectSpecialist(p.user_id, reason, p.updated_at).subscribe({
        next: () => {
          this.msg.success('Отклонено. Спец увидит причину в кабинете.');
          void this.router.navigate(['/admin/moderation']);
          resolve(true);
        },
        error: (e: { status?: number; error?: { error?: string; message?: string } }) => {
          if (e?.status === 409) {
            this.msg.warning(
              'Специалист отредактировал профиль — перезагрузите карточку и проверьте изменения.',
            );
          } else {
            this.msg.error(e?.error?.message || 'Не удалось отклонить');
          }
          resolve(false);
        },
      });
    });
  }

  public primaryCategoryTitle(): string {
    const p = this.profile();
    if (!p) return '';
    const pr = p.categories.find((c) => c.is_primary);
    return pr?.title || p.categories[0]?.title || '';
  }
}
