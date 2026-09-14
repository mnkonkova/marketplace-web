import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';
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
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { RowMenuComponent, RowMenuItem } from '@shared/ui/row-menu/row-menu.component';
import { StatusTagComponent } from '@shared/ui/status-tag/status-tag.component';

interface UserSearchItem {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: string;
}

/**
 * Команда: кто ведёт проекты в CRM.
 *
 * Раздел назывался «Менеджеры» по единственной роли, которую тогда
 * выдавали, и адрес был /admin/managers. Название «Команда» точнее: сюда
 * же придут админы и роли, которых пока нет, а переименовывать раздел
 * второй раз дороже, чем один.
 */
@Component({
  selector: 'app-admin-managers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzButtonModule,
    NzSelectModule,
    ListStateComponent,
    PageHeadComponent,
    RowMenuComponent,
    StatusTagComponent,
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

  public readonly loading = signal(true);

  public readonly error = signal<string | null>(null);

  public readonly candidates = signal<UserSearchItem[]>([]);

  public readonly searchLoading = signal(false);

  public readonly promoting = signal(false);

  public readonly lastInviteURL = signal<string>('');

  /** Форма добавления открывается по кнопке: её нажимают раз в месяц, а
   *  место она занимала на каждом заходе. */
  public readonly addOpen = signal(false);

  public promoteUserID = '';

  public readonly dontFilter = () => true;

  public readonly menu: RowMenuItem[] = [
    { code: 'invite', label: 'Выслать ссылку на вход' },
    {
      code: 'revoke',
      label: 'Снять роль менеджера',
      danger: true,
      confirm: 'Снять роль менеджера? Проекты останутся закреплены за ним.',
    },
  ];

  private readonly q$ = new Subject<string>();

  public constructor() {
    // Server-side autocomplete для поиска юзера-кандидата в менеджеры.
    // kind=all — ищем по всем (клиенты + специалисты): любой существующий
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

  public openAdd(): void {
    this.addOpen.set(true);
  }

  public closeAdd(): void {
    this.addOpen.set(false);
    this.promoteUserID = '';
    this.candidates.set([]);
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

  public onPick(m: ManagerInfo, code: string): void {
    if (code === 'invite') this.sendInvite(m);
    if (code === 'revoke') this.revoke(m);
  }

  public promote(sendInvite: boolean): void {
    if (!this.promoteUserID) return;
    this.promoting.set(true);
    this.api
      .promoteToManager(this.promoteUserID, sendInvite)
      .pipe(
        catchError((e: unknown) => {
          this.promoting.set(false);
          this.msg.error(parseApiError(e, 'Не удалось добавить в команду').message);
          return EMPTY;
        }),
      )
      .subscribe((res) => {
        this.promoting.set(false);
        this.msg.success(sendInvite ? 'Добавлен, ссылка на вход выдана' : 'Добавлен в команду');
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
        this.addOpen.set(true);
        this.msg.success('Ссылка на вход выдана');
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось выдать ссылку').message),
    });
  }

  public revoke(m: ManagerInfo): void {
    this.api.revokeManager(m.user_id).subscribe({
      next: () => {
        this.msg.success('Роль менеджера снята');
        this.fetch();
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось').message),
    });
  }

  // Показываем только активных менеджеров (is_approved=true). Эту страницу
  // используют для повседневной работы: «вот моя команда, выслать ссылку
  // или снять роль». Старая логика с pending-аппрувом убрана — выдача роли
  // ставит is_approved сразу.
  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listManagers(true).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить команду.').message);
      },
    });
  }
}
