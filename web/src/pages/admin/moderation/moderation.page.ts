import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { AdminApi, ModerationListStatus, ModerationQueueItem } from '@entities/admin/api/admin.api';
import { formatAgo } from '@shared/lib/format';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';

@Component({
  selector: 'app-admin-moderation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzAvatarModule,
    NzSelectModule,
    NzIconModule,
    ListStateComponent,
    PageHeadComponent,
    StatusTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './moderation.page.html',
  styleUrl: './moderation.page.scss',
})
export class AdminModerationPage implements OnInit {
  private readonly api = inject(AdminApi);

  public readonly loading = signal(true);

  public readonly error = signal<string | null>(null);

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

  public statusTone(s: ModerationQueueItem['moderation_status']): StatusTone {
    switch (s) {
      case 'pending_review':
        return 'wait';
      case 'approved':
        return 'ok';
      case 'rejected':
        return 'blocked';
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

  // Своя копия «сколько прошло» жила здесь и говорила «3 д назад», пока
  // в остальном приложении то же самое читалось «3 дня назад».
  public agoLabel(updatedAt: string): string {
    return formatAgo(updatedAt);
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listModerationQueue(this.statusFilter, 50, 0).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.total.set(r.total);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить очередь.').message);
      },
    });
  }
}
