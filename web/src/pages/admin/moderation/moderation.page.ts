import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzIconModule } from 'ng-zorro-antd/icon';

import {
  AdminApi,
  ModerationListStatus,
  ModerationQueueItem,
} from '@entities/admin/api/admin.api';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

@Component({
  selector: 'app-admin-moderation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NzTableModule,
    NzButtonModule,
    NzTagModule,
    NzAvatarModule,
    NzSelectModule,
    NzEmptyModule,
    NzIconModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './moderation.page.html',
  styleUrl: './moderation.page.scss',
})
export class AdminModerationPage implements OnInit {
  private readonly api = inject(AdminApi);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly items = signal<ModerationQueueItem[]>([]);

  public readonly total = signal(0);

  public statusFilter: ModerationListStatus = 'pending_review';

  public readonly statusOptions: { value: ModerationListStatus; label: string }[] = [
    { value: 'pending_review', label: 'Ожидают' },
    { value: 'approved', label: 'Одобренные' },
    { value: 'rejected', label: 'Отклонённые' },
    { value: 'all', label: 'Все' },
  ];

  public readonly emptyMessage = computed(() => {
    if (this.statusFilter === 'pending_review') return 'Очередь пуста — все заявки разобраны.';
    if (this.statusFilter === 'rejected') return 'Нет отклонённых заявок.';
    if (this.statusFilter === 'approved') return 'Пока никого не одобрили.';
    return 'Нет опубликованных профилей.';
  });

  public ngOnInit(): void {
    this.fetch();
  }

  public onStatusChange(): void {
    this.fetch();
  }

  public statusTagColor(s: ModerationQueueItem['moderation_status']): string {
    switch (s) {
      case 'pending_review':
        return 'gold';
      case 'approved':
        return 'green';
      case 'rejected':
        return 'red';
    }
  }

  public statusTagLabel(s: ModerationQueueItem['moderation_status']): string {
    switch (s) {
      case 'pending_review':
        return 'Ждёт';
      case 'approved':
        return 'Одобрен';
      case 'rejected':
        return 'Отклонён';
    }
  }

  public agoLabel(updatedAt: string): string {
    const diffMs = Date.now() - new Date(updatedAt).getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return `${m} мин назад`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ч назад`;
    const d = Math.floor(h / 24);
    return `${d} д назад`;
  }

  private fetch(): void {
    this.loading.set(true);
    this.api.listModerationQueue(this.statusFilter, 50, 0).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.total.set(r.total);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.msg.error('Не удалось загрузить очередь');
      },
    });
  }
}
