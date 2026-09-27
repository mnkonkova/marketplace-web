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
import { AdminApi } from '@entities/admin/api/admin.api';
import {
  ActiveProjectRef,
  ActiveProjectsConflict,
  TeamMember,
} from '@entities/admin/model/admin-shell.types';
import { AdminSummaryStore } from '@entities/admin/model/admin-summary.store';
import { parseApiError } from '@shared/api/api-error';
import { copyToClipboard } from '@shared/lib/clipboard';
import { formatAgo, plural } from '@shared/lib/format';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { RowMenuComponent, RowMenuItem } from '@shared/ui/row-menu/row-menu.component';
import { StatusTagComponent } from '@shared/ui/status-tag/status-tag.component';
import { PersonCardComponent } from '@widgets/person-card/person-card.component';
import { PersonCardStore } from '@widgets/person-card/person-card.store';

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
 * же придут админы и роли, которых пока нет.
 *
 * Снятие роли здесь — не одна кнопка, а сценарий. Пока проекты остаются
 * за человеком, который больше не может их открыть, тишина по проекту
 * выясняется через неделю от клиента. Поэтому сервер отвечает 409 со
 * списком, а экран предлагает передать дела тут же.
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
    PersonCardComponent,
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

  private readonly person = inject(PersonCardStore);

  private readonly summary = inject(AdminSummaryStore);

  public readonly items = signal<TeamMember[]>([]);

  public readonly loading = signal(true);

  public readonly error = signal<string | null>(null);

  public readonly candidates = signal<UserSearchItem[]>([]);

  public readonly searchLoading = signal(false);

  public readonly promoting = signal(false);

  /** Форма добавления открывается по кнопке: её нажимают раз в месяц. */
  public readonly addOpen = signal(false);

  public promoteUserID = '';

  public readonly dontFilter = () => true;

  // ── ссылка для входа ──────────────────────────────────
  /** Кому выдали ссылку и какую. Пусто — окно закрыто. */
  public readonly loginLink = signal<{ member: TeamMember; url: string; expiresAt: string } | null>(
    null,
  );

  public readonly copied = signal(false);

  // ── передача дел ──────────────────────────────────────
  /** Кого освобождаем, что на нём висит и зачем спросили. */
  public readonly transfer = signal<{
    from: TeamMember;
    projects: ActiveProjectRef[];
    /** true — сюда попали из отказа снять роль: после передачи снимем её. */
    thenRevoke: boolean;
  } | null>(null);

  public transferTo = '';

  public readonly transferring = signal(false);

  /** Кому можно передать: действующие менеджеры, кроме самого уходящего. */
  public readonly transferTargets = computed(() => {
    const t = this.transfer();
    return this.items().filter(
      (m) => m.is_manager && m.is_approved && m.is_active && m.user_id !== t?.from.user_id,
    );
  });

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

  public name(m: TeamMember): string {
    return m.display_name || m.email || m.user_id;
  }

  public initial(m: TeamMember): string {
    return (this.name(m).trim().charAt(0) || '·').toUpperCase();
  }

  /** Почта под именем — только если она что-то добавляет: у половины
   *  команды имени нет, и строка «почта под почтой» повторяет саму себя. */
  public secondLine(m: TeamMember): string {
    return m.display_name && m.email ? m.email : '';
  }

  public roleLabel(m: TeamMember): string {
    return m.is_admin ? 'Админ' : 'Менеджер';
  }

  public ago(iso?: string): string {
    return iso ? formatAgo(iso) : '';
  }

  public peopleWord(n: number): string {
    return plural(n, 'человек', 'человека', 'человек');
  }

  public projectsWord(n: number): string {
    return plural(n, 'проект', 'проекта', 'проектов');
  }

  public openCard(m: TeamMember, ev: Event): void {
    this.person.open(m.user_id, ev.currentTarget);
  }

  // ── меню строки ───────────────────────────────────────
  public menuFor(m: TeamMember): RowMenuItem[] {
    const out: RowMenuItem[] = [
      { code: 'card', label: 'Открыть карточку' },
      { code: 'login', label: 'Ссылка для входа' },
    ];
    if (m.is_manager) {
      out.push({
        code: 'transfer',
        label: 'Передать проекты',
        disabled: m.active_projects === 0,
      });
      out.push({
        code: 'revoke',
        label: 'Снять роль менеджера',
        danger: true,
        confirm: m.active_projects
          ? `На нём ${m.active_projects} ${this.projectsWord(m.active_projects)} в работе — сначала спросим, кому их передать. Продолжить?`
          : 'Снять роль менеджера? Доступ в CRM закроется, аккаунт останется.',
      });
    }
    return out;
  }

  public onPick(m: TeamMember, code: string, ev?: Event): void {
    switch (code) {
      case 'card':
        return this.person.open(m.user_id, ev?.currentTarget ?? null);
      case 'login':
        return this.askLoginLink(m);
      case 'transfer':
        return this.askTransfer(m, [], false);
      case 'revoke':
        return this.revoke(m);
    }
  }

  // ── ссылка для входа ──────────────────────────────────
  public askLoginLink(m: TeamMember): void {
    this.api.staffLoginLink(m.user_id).subscribe({
      next: (r) => {
        this.copied.set(false);
        this.loginLink.set({ member: m, url: r.url, expiresAt: r.expires_at });
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось выдать ссылку').message),
    });
  }

  public closeLoginLink(): void {
    this.loginLink.set(null);
  }

  public copyLink(): void {
    const l = this.loginLink();
    if (!l) return;
    const ok = copyToClipboard(l.url);
    this.copied.set(ok);
    if (!ok) this.msg.error('Скопировать не вышло — выделите ссылку и скопируйте вручную.');
  }

  // ── передача дел ──────────────────────────────────────
  public askTransfer(from: TeamMember, projects: ActiveProjectRef[], thenRevoke: boolean): void {
    this.transferTo = '';
    this.transfer.set({ from, projects, thenRevoke });
  }

  public closeTransfer(): void {
    this.transfer.set(null);
    this.transferTo = '';
  }

  public doTransfer(): void {
    const t = this.transfer();
    if (!t || !this.transferTo) return;
    this.transferring.set(true);
    // Список проектов не шлём: передаём все незавершённые — это и есть
    // сценарий «сотрудник уходит». Выборочная передача одного проекта
    // делается назначением в самой карточке проекта.
    this.api.transferProjects(t.from.user_id, this.transferTo).subscribe({
      next: (r) => {
        this.transferring.set(false);
        this.msg.success(`Передано ${r.transferred} ${this.projectsWord(r.transferred)}`);
        const thenRevoke = t.thenRevoke;
        const from = t.from;
        this.closeTransfer();
        if (thenRevoke) this.doRevoke(from);
        else this.fetch();
      },
      error: (e) => {
        this.transferring.set(false);
        this.msg.error(parseApiError(e, 'Не удалось передать проекты').message);
      },
    });
  }

  // ── снятие роли ───────────────────────────────────────
  public revoke(m: TeamMember): void {
    this.doRevoke(m);
  }

  private doRevoke(m: TeamMember): void {
    this.api.revokeManager(m.user_id).subscribe({
      next: () => {
        this.msg.success('Роль менеджера снята');
        this.fetch();
      },
      error: (e: { status?: number; error?: ActiveProjectsConflict }) => {
        // 409 — не сбой, а продолжение сценария: сервер говорит, что
        // именно держит человека, и передать это можно прямо здесь.
        if (e?.status === 409 && e.error?.projects?.length) {
          this.askTransfer(m, e.error.projects, true);
          return;
        }
        this.msg.error(parseApiError(e, 'Не удалось снять роль').message);
      },
    });
  }

  // ── добавление в команду ──────────────────────────────
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
    return parts.join(' · ');
  }

  public promote(): void {
    if (!this.promoteUserID) return;
    this.promoting.set(true);
    this.api
      .promoteToManager(this.promoteUserID, false)
      .pipe(
        catchError((e: unknown) => {
          this.promoting.set(false);
          this.msg.error(parseApiError(e, 'Не удалось добавить в команду').message);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.promoting.set(false);
        this.msg.success('Добавлен в команду. Ссылку для входа выдайте в меню строки.');
        this.closeAdd();
        this.fetch();
      });
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listTeam().subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.loading.set(false);
        // Состав команды поменялся — счётчик в сайдбаре считает её же.
        this.summary.reload();
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить команду.').message);
      },
    });
  }
}
