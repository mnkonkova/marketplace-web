import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  of,
  Subject,
  switchMap,
} from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { AdminApi, ManagerInfo } from '@entities/admin/api/admin.api';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

interface UserSearchItem {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: string;
}

@Component({
  selector: 'app-admin-managers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzButtonModule,
    NzTagModule,
    NzSelectModule,
    NzPopconfirmModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './managers.page.html',
  styleUrl: './managers.page.scss',
})
export class AdminManagersPage implements OnInit {
  private readonly api = inject(AdminApi);

  private readonly http = inject(HttpClient);

  private readonly apiBase = inject(API_URL);

  private readonly msg = inject(NzMessageService);

  public readonly items = signal<ManagerInfo[]>([]);

  public readonly candidates = signal<UserSearchItem[]>([]);

  public readonly searchLoading = signal(false);

  public readonly promoting = signal(false);

  public readonly lastInviteURL = signal<string>('');

  public promoteUserID = '';

  public readonly dontFilter = () => true;

  private readonly q$ = new Subject<string>();

  public constructor() {
    // Server-side autocomplete для поиска юзера-кандидата в менеджеры.
    // kind=all — ищем по всем (клиенты + специалисты): любой existing
    // юзер может стать менеджером (отдельной регистрации не нужно).
    this.q$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) return of<UserSearchItem[]>([]);
          this.searchLoading.set(true);
          return this.http
            .get<{ items: UserSearchItem[] }>(`${this.apiBase}/admin/users/search`, {
              params: { q, kind: 'all' },
            })
            .pipe(catchError(() => of({ items: [] as UserSearchItem[] })));
        }),
      )
      .subscribe((r) => {
        this.searchLoading.set(false);
        const items = Array.isArray(r) ? r : r.items;
        this.candidates.set(items);
      });
  }

  public ngOnInit(): void {
    this.fetch();
  }

  public onSearch(q: string): void {
    this.q$.next(q);
  }

  public formatLabel(u: UserSearchItem): string {
    const parts: string[] = [];
    if (u.display_name) parts.push(u.display_name);
    if (u.email) parts.push(u.email);
    if (u.phone) parts.push(u.phone);
    parts.push(`(${u.kind})`);
    return parts.join(' · ');
  }

  public promote(sendInvite: boolean): void {
    if (!this.promoteUserID) return;
    this.promoting.set(true);
    this.api
      .promoteToManager(this.promoteUserID, sendInvite)
      .pipe(
        catchError((e: { error?: { message?: string } }) => {
          this.promoting.set(false);
          this.msg.error(e?.error?.message || 'Не удалось');
          return EMPTY;
        }),
      )
      .subscribe((res) => {
        this.promoting.set(false);
        this.msg.success(sendInvite ? 'Promote + invite готово' : 'Promote готово');
        this.lastInviteURL.set(res?.url || '');
        this.promoteUserID = '';
        this.candidates.set([]);
        this.fetch();
      });
  }

  public sendInvite(m: ManagerInfo): void {
    this.api.generateInvite(m.user_id).subscribe({
      next: (res) => {
        this.lastInviteURL.set(res.url);
        this.msg.success('Magic-link выдан');
      },
      error: (e: { error?: { message?: string } }) =>
        this.msg.error(e?.error?.message || 'Не удалось'),
    });
  }

  public revoke(m: ManagerInfo): void {
    this.api.revokeManager(m.user_id).subscribe({
      next: () => {
        this.msg.success('Снят');
        this.fetch();
      },
      error: () => this.msg.error('Не удалось'),
    });
  }

  // Показываем только активных менеджеров (is_approved=true). Эту страницу
  // используют для повседневной работы: «вот мои менеджеры, отправить им
  // invite или снять». Старая логика с pending-аппрувом убрана — promote
  // ставит is_approved сразу.
  private fetch(): void {
    this.api.listManagers(true).subscribe((r) => this.items.set(r.items));
  }
}
