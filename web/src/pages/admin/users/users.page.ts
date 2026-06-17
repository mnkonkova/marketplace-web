import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzTableModule, NzTableQueryParams } from 'ng-zorro-antd/table';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzMessageService } from 'ng-zorro-antd/message';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import {
  AdminApi,
  ListAllUsersParams,
  UserListItem,
} from '@entities/admin/api/admin.api';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

type KindFilter = '' | 'client' | 'specialist';
type RoleFilter = '' | 'manager' | 'admin' | 'regular';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzInputModule,
    NzSelectModule,
    NzTagModule,
    NzEmptyModule,
    NzIconModule,
    NzButtonModule,
    NzPopconfirmModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.page.html',
  styleUrl: './users.page.scss',
})
export class AdminUsersPage implements OnInit {
  private readonly api = inject(AdminApi);

  private readonly msg = inject(NzMessageService);

  private readonly router = inject(Router);

  public readonly items = signal<UserListItem[]>([]);

  public readonly total = signal(0);

  public readonly loading = signal(false);

  public readonly pageIndex = signal(1);

  public readonly pageSize = signal(20);

  // Поиск с debounce — через Subject, чтобы не дёргать /admin/users
  // на каждый символ. distinctUntilChanged игнорит дубли.
  private readonly search$ = new Subject<string>();

  public q = '';

  public kind: KindFilter = '';

  public role: RoleFilter = '';

  public readonly kindOptions: { value: KindFilter; label: string }[] = [
    { value: '', label: 'Все типы' },
    { value: 'client', label: 'Клиенты' },
    { value: 'specialist', label: 'Специалисты' },
  ];

  public readonly roleOptions: { value: RoleFilter; label: string }[] = [
    { value: '', label: 'Все роли' },
    { value: 'regular', label: 'Обычные' },
    { value: 'manager', label: 'Менеджеры' },
    { value: 'admin', label: 'Админы' },
  ];

  public constructor() {
    this.search$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => {
        this.pageIndex.set(1);
        this.fetch();
      });
  }

  public ngOnInit(): void {
    this.fetch();
  }

  public onSearch(): void {
    this.search$.next(this.q.trim());
  }

  public onFilterChange(): void {
    this.pageIndex.set(1);
    this.fetch();
  }

  // nz-table эмитит query params при изменении страницы/размера.
  // Бэк сам считает offset = (pageIndex - 1) * pageSize.
  public onQueryParamsChange(p: NzTableQueryParams): void {
    if (p.pageIndex !== this.pageIndex() || p.pageSize !== this.pageSize()) {
      this.pageIndex.set(p.pageIndex);
      this.pageSize.set(p.pageSize);
      this.fetch();
    }
  }

  public verifyEmail(u: UserListItem): void {
    // popconfirm уже подтверждён, stopPropagation на сам button-click
    // навешан в шаблоне, чтобы клик по кнопке не дёрнул openProfile у строки.
    this.api.verifyEmail(u.user_id).subscribe({
      next: () => {
        this.msg.success(`Email подтверждён: ${u.email || u.user_id}`);
        // Локально обновим запись чтобы не делать второй запрос за списком.
        this.items.update((list) =>
          list.map((it) => (it.user_id === u.user_id ? { ...it, email_verified: true } : it)),
        );
      },
      error: () => this.msg.error('Не удалось подтвердить email'),
    });
  }

  public toggleActive(u: UserListItem): void {
    const target = !u.is_active;
    const obs = target ? this.api.activateUser(u.user_id) : this.api.deactivateUser(u.user_id);
    obs.subscribe({
      next: () => {
        this.msg.success(target ? 'Активирован' : 'Деактивирован');
        this.items.update((list) =>
          list.map((it) =>
            it.user_id === u.user_id ? { ...it, is_active: target } : it,
          ),
        );
      },
      error: (e: { error?: { message?: string } }) =>
        this.msg.error(e?.error?.message || 'Не удалось'),
    });
  }

  public makeManager(u: UserListItem): void {
    // sendInvite=false — приглашение шлём отдельно через generateInvite,
    // тут только повышаем роль. is_approved выставляется в TRUE автоматом
    // на бэке.
    this.api.promoteToManager(u.user_id, false).subscribe({
      next: () => {
        this.msg.success('Роль менеджера выдана');
        this.items.update((list) =>
          list.map((it) =>
            it.user_id === u.user_id
              ? { ...it, is_manager: true, is_approved: true }
              : it,
          ),
        );
      },
      error: (e: { error?: { message?: string } }) =>
        this.msg.error(e?.error?.message || 'Не удалось'),
    });
  }

  public demoteManager(u: UserListItem): void {
    this.api.revokeManager(u.user_id).subscribe({
      next: () => {
        this.msg.success('Снят с роли менеджера');
        this.items.update((list) =>
          list.map((it) =>
            it.user_id === u.user_id
              ? { ...it, is_manager: false, is_approved: false }
              : it,
          ),
        );
      },
      error: () => this.msg.error('Не удалось'),
    });
  }

  // Approve спеца прямо из списка — для очевидных случаев когда не нужно
  // открывать карточку и читать bio/портфолио. Если хочется отказать с
  // причиной — кнопка «На модерацию» открывает детальную страницу с
  // textarea для reason. expected_updated_at не шлём — это «быстрый approve»
  // без оптимистик-лока (бэк допускает nil для legacy/CLI).
  public approveSpecialist(u: UserListItem): void {
    this.api.approveSpecialist(u.user_id, undefined).subscribe({
      next: () => {
        this.msg.success('Спец одобрен');
        this.items.update((list) =>
          list.map((it) =>
            it.user_id === u.user_id ? { ...it, moderation_status: 'approved' } : it,
          ),
        );
      },
      error: (e: { error?: { message?: string } }) =>
        this.msg.error(e?.error?.message || 'Не удалось одобрить'),
    });
  }

  public openModeration(u: UserListItem, ev: Event): void {
    ev.stopPropagation();
    this.router.navigate(['/admin/moderation', u.user_id]);
  }

  public openProfile(u: UserListItem): void {
    // Профиль есть только для специалистов. Для клиентов клик пока no-op
    // (страницы клиентского профиля нет — будет в Wave 2).
    if (u.kind === 'specialist' || u.kind === 'both') {
      this.router.navigate(['/specialist', u.user_id]);
    }
  }

  public roleLabel(u: UserListItem): { text: string; color: string } {
    if (u.is_admin) return { text: 'Admin', color: 'red' };
    if (u.is_manager) return { text: 'Manager', color: 'purple' };
    if (u.kind === 'specialist' || u.kind === 'both')
      return { text: 'Специалист', color: 'blue' };
    return { text: 'Клиент', color: 'default' };
  }

  public kindLabel(k: UserListItem['kind']): string {
    return k === 'client' ? 'Клиент' : k === 'specialist' ? 'Специалист' : 'Оба';
  }

  public modStatusTag(u: UserListItem): { text: string; color: string } | null {
    // Спец не нажал «Опубликовать» — это черновик, не в очереди /admin/moderation.
    // moderation_status у него по дефолту pending_review, но статус «Ждёт» вводит
    // в заблуждение (никого админ не ждёт).
    if (u.moderation_status && !u.is_published) {
      return { text: 'Черновик', color: 'default' };
    }
    switch (u.moderation_status) {
      case 'pending_review':
        return { text: 'Ждёт', color: 'gold' };
      case 'approved':
        return { text: 'Одобрен', color: 'green' };
      case 'rejected':
        return { text: 'Отклонён', color: 'red' };
      default:
        return null;
    }
  }

  private fetch(): void {
    this.loading.set(true);
    const params: ListAllUsersParams = {
      limit: this.pageSize(),
      offset: (this.pageIndex() - 1) * this.pageSize(),
    };
    const q = this.q.trim();
    if (q.length >= 2) params.q = q;
    if (this.kind) params.kind = this.kind;
    if (this.role) params.role = this.role;
    this.api.listAllUsers(params).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.total.set(r.total);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.msg.error('Не удалось загрузить список');
      },
    });
  }
}
