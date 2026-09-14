import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { NzTableModule, NzTableQueryParams } from 'ng-zorro-antd/table';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { AdminApi, ListAllUsersParams, UserListItem } from '@entities/admin/api/admin.api';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { RowMenuComponent, RowMenuItem } from '@shared/ui/row-menu/row-menu.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';
import { CrmShellStore } from '@widgets/crm-layout/crm-shell.store';
import { PersonCardComponent } from '@widgets/person-card/person-card.component';
import { PersonCardStore } from '@widgets/person-card/person-card.store';

type KindFilter = '' | 'client' | 'specialist';
type RoleFilter = '' | 'manager' | 'admin' | 'regular';

/**
 * Все пользователи маркетплейса одним списком.
 *
 * В сайдбаре его нет: там «Специалисты» и «Клиенты» по отдельности — так
 * на них и смотрят. Но разделить их пока нечем, а этот экран единственный,
 * откуда выдают роль менеджера, подтверждают почту и блокируют аккаунт,
 * поэтому он остаётся и открывается прямой ссылкой (см. заглушки в
 * pages/admin/people).
 */
@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzInputModule,
    NzSelectModule,
    ListStateComponent,
    PageHeadComponent,
    RowMenuComponent,
    StatusTagComponent,
    PersonCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.page.html',
  styleUrl: './users.page.scss',
})
export class AdminUsersPage implements OnInit, OnDestroy {
  private readonly api = inject(AdminApi);

  private readonly msg = inject(NzMessageService);

  private readonly router = inject(Router);

  private readonly shell = inject(CrmShellStore);

  private readonly route = inject(ActivatedRoute);

  private readonly person = inject(PersonCardStore);

  public readonly items = signal<UserListItem[]>([]);

  public readonly total = signal(0);

  public readonly loading = signal(false);

  public readonly error = signal<string | null>(null);

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
    { value: 'regular', label: 'Без роли' },
    { value: 'manager', label: 'Менеджеры' },
    { value: 'admin', label: 'Админы' },
  ];

  public constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
      this.pageIndex.set(1);
      this.fetch();
    });
  }

  public ngOnInit(): void {
    // Раздела нет в сайдбаре, и путь оболочке взять неоткуда — «Админка»
    // одна в крошках выглядела бы как обрыв.
    this.shell.setTrail([{ label: 'Люди' }, { label: 'Все пользователи' }]);
    // ?person=… — сюда приводит ⌘K: человека там находят, а открывается
    // он карточкой поверх списка, своей страницы у него нет.
    const wanted = this.route.snapshot.queryParamMap.get('person');
    if (wanted) this.person.open(wanted, null);
    // ?kind=… — сюда ведут заглушки «Специалисты» и «Клиенты»: пока у них
    // нет своего экрана, ссылка обязана открыть хотя бы нужный срез.
    const kind = this.route.snapshot.queryParamMap.get('kind');
    if (kind === 'client' || kind === 'specialist') this.kind = kind;
    this.fetch();
  }

  public ngOnDestroy(): void {
    this.shell.reset();
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

  public retry(): void {
    this.fetch();
  }

  /**
   * Что можно сделать с этой строкой.
   *
   * Собирается здесь, а не в шаблоне: набор зависит от четырёх флагов
   * сразу, и в разметке это были пять вложенных @if, из которых не читалось
   * ни одного правила целиком.
   */
  public menuFor(u: UserListItem): RowMenuItem[] {
    const out: RowMenuItem[] = [{ code: 'card', label: 'Открыть карточку' }];
    const who = u.display_name || u.email || 'пользователя';
    if (u.kind === 'specialist' || u.kind === 'both') {
      out.push({ code: 'profile', label: 'Публичный профиль' });
    }
    if (
      u.is_published &&
      (u.moderation_status === 'pending_review' || u.moderation_status === 'rejected')
    ) {
      out.push({
        code: 'approve',
        label: 'Одобрить профиль',
        confirm: `Одобрить профиль без открытия карточки?`,
      });
    }
    if (u.is_published && u.moderation_status) {
      out.push({ code: 'moderation', label: 'Открыть модерацию' });
    }
    if (!u.email_verified) {
      out.push({
        code: 'verify',
        label: 'Подтвердить почту',
        confirm: 'Подтвердить почту вручную?',
      });
    }
    if (!u.is_manager && !u.is_admin) {
      out.push({
        code: 'promote',
        label: 'Выдать роль менеджера',
        confirm: `Сделать ${who} менеджером?`,
      });
    } else if (u.is_manager) {
      out.push({
        code: 'demote',
        label: 'Снять роль менеджера',
        danger: true,
        confirm: `Снять с ${who} роль менеджера? Проекты останутся за ним.`,
      });
    }
    // Админа не блокируем: единственный способ остаться без доступа ко
    // всей CRM — сделать это с собой.
    if (!u.is_admin) {
      out.push(
        u.is_active
          ? {
              code: 'block',
              label: 'Заблокировать',
              danger: true,
              confirm: `Заблокировать ${who}? Войти он больше не сможет.`,
            }
          : { code: 'unblock', label: 'Разблокировать' },
      );
    }
    return out;
  }

  public onPick(u: UserListItem, code: string): void {
    switch (code) {
      case 'approve':
        return this.approveSpecialist(u);
      case 'card':
        return this.person.open(u.user_id, null);
      case 'profile':
        void this.router.navigate(['/specialist', u.user_id]);
        return;
      case 'moderation':
        void this.router.navigate(['/admin/moderation', u.user_id]);
        return;
      case 'verify':
        return this.verifyEmail(u);
      case 'promote':
        return this.makeManager(u);
      case 'demote':
        return this.demoteManager(u);
      case 'block':
      case 'unblock':
        return this.setActive(u, code === 'unblock');
    }
  }

  public verifyEmail(u: UserListItem): void {
    this.api.verifyEmail(u.user_id).subscribe({
      next: () => {
        this.msg.success(`Почта подтверждена: ${u.email || u.user_id}`);
        // Локально обновим запись чтобы не делать второй запрос за списком.
        this.items.update((list) =>
          list.map((it) => (it.user_id === u.user_id ? { ...it, email_verified: true } : it)),
        );
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось подтвердить почту').message),
    });
  }

  public setActive(u: UserListItem, target: boolean): void {
    const obs = target ? this.api.activateUser(u.user_id) : this.api.deactivateUser(u.user_id);
    obs.subscribe({
      next: () => {
        this.msg.success(target ? 'Разблокирован' : 'Заблокирован');
        this.items.update((list) =>
          list.map((it) => (it.user_id === u.user_id ? { ...it, is_active: target } : it)),
        );
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось').message),
    });
  }

  public makeManager(u: UserListItem): void {
    // sendInvite=false — приглашение шлём отдельно со страницы «Команда»,
    // тут только повышаем роль. is_approved выставляется в TRUE автоматом
    // на бэке.
    this.api.promoteToManager(u.user_id, false).subscribe({
      next: () => {
        this.msg.success('Роль менеджера выдана');
        this.items.update((list) =>
          list.map((it) =>
            it.user_id === u.user_id ? { ...it, is_manager: true, is_approved: true } : it,
          ),
        );
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось').message),
    });
  }

  public demoteManager(u: UserListItem): void {
    this.api.revokeManager(u.user_id).subscribe({
      next: () => {
        this.msg.success('Роль менеджера снята');
        this.items.update((list) =>
          list.map((it) =>
            it.user_id === u.user_id ? { ...it, is_manager: false, is_approved: false } : it,
          ),
        );
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось').message),
    });
  }

  // Одобрение спеца прямо из списка — для очевидных случаев, когда не нужно
  // открывать карточку и читать bio/портфолио. Если хочется отказать с
  // причиной — «Открыть модерацию» ведёт на страницу с полем для причины.
  // expected_updated_at не шлём — это «быстрый approve» без оптимистик-лока
  // (бэк допускает nil для legacy/CLI).
  public approveSpecialist(u: UserListItem): void {
    this.api.approveSpecialist(u.user_id, undefined).subscribe({
      next: () => {
        this.msg.success('Профиль одобрен');
        this.items.update((list) =>
          list.map((it) =>
            it.user_id === u.user_id ? { ...it, moderation_status: 'approved' } : it,
          ),
        );
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось одобрить').message),
    });
  }

  /** Карточка человека — всё о нём на одной панели, не уходя из списка. */
  public openCard(u: UserListItem, ev: Event): void {
    this.person.open(u.user_id, ev.currentTarget);
  }

  public roleLabel(u: UserListItem): { text: string; tone: StatusTone } {
    // Роль — не «хорошо/плохо», а факт: цвет здесь нейтральный у всех,
    // кроме админа. Красный у админа говорит «этот всё может», а не
    // «что-то не так».
    if (u.is_admin) return { text: 'Админ', tone: 'blocked' };
    if (u.is_manager) return { text: 'Менеджер', tone: 'neutral' };
    // «Оба» — и заказчик, и исполнитель: по роли это специалист, но
    // проекты у него есть с обеих сторон, и колонка должна это говорить.
    if (u.kind === 'both') return { text: 'Специалист и клиент', tone: 'neutral' };
    if (u.kind === 'specialist') return { text: 'Специалист', tone: 'neutral' };
    return { text: 'Клиент', tone: 'neutral' };
  }

  public modStatusTag(u: UserListItem): { text: string; tone: StatusTone } | null {
    // Спец не нажал «Опубликовать» — это черновик, не в очереди /admin/moderation.
    // moderation_status у него по дефолту pending_review, но статус «Ждёт» вводит
    // в заблуждение (никого админ не ждёт).
    if (u.moderation_status && !u.is_published) {
      return { text: 'Черновик', tone: 'neutral' };
    }
    switch (u.moderation_status) {
      case 'pending_review':
        return { text: 'Ждёт', tone: 'wait' };
      case 'approved':
        return { text: 'Одобрен', tone: 'ok' };
      case 'rejected':
        return { text: 'Отклонён', tone: 'blocked' };
      default:
        return null;
    }
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
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
      error: (e) => {
        this.loading.set(false);
        this.items.set([]);
        this.error.set(parseApiError(e, 'Не удалось загрузить список.').message);
      },
    });
  }
}
