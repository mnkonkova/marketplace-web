import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { AdminApi } from '@entities/admin/api/admin.api';
import { SpecialistPlatform, UserCard } from '@entities/admin/model/admin-shell.types';
import { AUDIT_ACTION_LABEL } from '@entities/admin/lib/audit-labels';
import { parseApiError } from '@shared/api/api-error';
import { formatAgo } from '@shared/lib/format';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import { Platform } from '@entities/publication/model/publication.types';
import { PROJECT_KIND_LABEL } from '@shared/lib/project-status';
import { CrmIconComponent } from '@shared/ui/crm-icon/crm-icon.component';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';
import { SheetComponent } from '@shared/ui/sheet/sheet.component';
import { isTouchDevice } from '@shared/lib/touch';

import { PersonCardStore } from './person-card.store';

const ROLE_IN_PROJECT: Record<string, string> = {
  client: 'заказчик',
  specialist: 'исполнитель',
  manager: 'менеджер',
};

/**
 * Карточка человека — выезжающая панель.
 *
 * «Посмотреть человека» означало искать его в четырёх местах: строка в
 * списке пользователей, решение модерации — в очереди, проекты — поиском
 * по имени, история — в логах сервера. Ровно на этом рассыпался разбор
 * любого спорного случая: половину данных искали руками, половину не
 * находили.
 *
 * Панель, а не страница: человека смотрят, не уходя из списка, в котором
 * его нашли, — и возвращаются в то же место списка, а не на его первую
 * страницу.
 */
@Component({
  selector: 'app-person-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CrmIconComponent,
    ListStateComponent,
    StatusTagComponent,
    SheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './person-card.component.html',
  styleUrl: './person-card.component.scss',
})
export class PersonCardComponent {
  private readonly api = inject(AdminApi);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  private readonly store = inject(PersonCardStore);

  /** Решение модерации принято — списку, из которого открыли, надо обновиться. */
  public readonly changed = output<void>();

  public readonly userId = this.store.userId;

  public readonly card = signal<UserCard | null>(null);

  public readonly loading = signal(false);

  public readonly error = signal<string | null>(null);

  public readonly busy = signal(false);

  /** Открыта форма отказа: причину видит специалист, её пишут словами. */
  public readonly rejecting = signal(false);

  public reason = '';

  public readonly name = computed(() => {
    const c = this.card();
    return c ? c.display_name || c.email || c.user_id : '';
  });

  /**
   * На телефоне карточка открывается нижним листом: панель у правого
   * края занимает там весь экран, но открывается от мизинца, не
   * прокручивается телом и не закрывается смахиванием.
   */
  public readonly touch = isTouchDevice();

  /** Подпись под именем в шапке листа: роль и почта, как на десктопе. */
  public readonly sheetNote = computed(() => {
    const c = this.card();
    if (!c) return '';
    return c.email ? `${this.role()} · ${c.email}` : this.role();
  });

  public readonly initial = computed(() => (this.name().trim().charAt(0) || '·').toUpperCase());

  /** Кто он: роль в CRM важнее типа аккаунта — она даёт права. */
  public readonly role = computed(() => {
    const c = this.card();
    if (!c) return '';
    if (c.is_admin) return 'Админ';
    if (c.is_manager) return 'Менеджер';
    if (c.kind === 'both') return 'Специалист и клиент';
    return c.kind === 'specialist' ? 'Специалист' : 'Клиент';
  });

  public constructor() {
    effect(() => {
      const id = this.userId();
      if (!id) {
        this.card.set(null);
        this.rejecting.set(false);
        this.reason = '';
        return;
      }
      this.fetch(id);
    });
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    if (this.userId()) this.close();
  }

  public close(): void {
    const back = this.store.close();
    queueMicrotask(() => back?.focus());
  }

  public retry(): void {
    const id = this.userId();
    if (id) this.fetch(id);
  }

  public moderationTone(status: string): StatusTone {
    if (status === 'approved') return 'ok';
    if (status === 'rejected') return 'blocked';
    return 'wait';
  }

  public moderationLabel(c: UserCard): string {
    const m = c.moderation;
    if (!m) return '';
    // Не нажал «Опубликовать» — это черновик, а не очередь: «Ждёт»
    // означало бы, что решения ждут от нас.
    if (!m.is_published) return 'Черновик';
    switch (m.status) {
      case 'pending_review':
        return 'Ждёт решения';
      case 'approved':
        return 'Одобрен';
      case 'rejected':
        return 'Отклонён';
      default:
        return m.status;
    }
  }

  /** Решение ждёт нас — только у опубликованного профиля. */
  public readonly awaitsDecision = computed(() => {
    const m = this.card()?.moderation;
    return !!m && m.is_published && m.status === 'pending_review';
  });

  /**
   * Площадки специалиста. Массив приходит целиком — пять элементов в
   * фиксированном порядке, — и заполненность считаем по нему же: второе
   * число рядом с массивом рано или поздно с ним разойдётся.
   */
  public readonly platforms = computed<SpecialistPlatform[]>(() => this.card()?.platforms ?? []);

  public readonly platformsFilled = computed(
    () => this.platforms().filter((p) => !!p.handle).length,
  );

  public platformLabel(p: SpecialistPlatform): string {
    return PLATFORM_LABEL[p.platform as Platform] ?? p.platform;
  }

  public roleInProject(role: string): string {
    return ROLE_IN_PROJECT[role] ?? role;
  }

  public kindLabel(kind: string): string {
    return PROJECT_KIND_LABEL[kind as keyof typeof PROJECT_KIND_LABEL] ?? kind;
  }

  public actionLabel(action: string): string {
    return AUDIT_ACTION_LABEL[action] ?? action;
  }

  public ago(iso?: string): string {
    return iso ? formatAgo(iso) : '';
  }

  public openProject(id: string): void {
    this.close();
    void this.router.navigate(['/manager/projects', id]);
  }

  /** Полная история по человеку — в журнале с фильтром по нему. */
  public openAudit(): void {
    const id = this.userId();
    this.close();
    void this.router.navigate(['/admin/audit'], {
      queryParams: { object_type: 'user', object_id: id },
    });
  }

  public approve(): void {
    const id = this.userId();
    if (!id) return;
    this.busy.set(true);
    this.api.approveSpecialist(id, undefined).subscribe({
      next: () => this.afterDecision('Профиль одобрен — специалист появился в каталоге'),
      error: (e) => this.fail(e, 'Не удалось одобрить'),
    });
  }

  public askReject(): void {
    this.rejecting.set(true);
  }

  public cancelReject(): void {
    this.rejecting.set(false);
    this.reason = '';
  }

  public reject(): void {
    const id = this.userId();
    if (!id) return;
    const reason = this.reason.trim();
    if (!reason) {
      this.msg.error('Напишите, что исправить: причину увидит специалист.');
      return;
    }
    this.busy.set(true);
    this.api.rejectSpecialist(id, reason, undefined).subscribe({
      next: () => this.afterDecision('Профиль отклонён, причина ушла специалисту'),
      error: (e) => this.fail(e, 'Не удалось отклонить'),
    });
  }

  private afterDecision(text: string): void {
    this.busy.set(false);
    this.rejecting.set(false);
    this.reason = '';
    this.msg.success(text);
    this.changed.emit();
    this.retry();
  }

  private fail(e: unknown, fallback: string): void {
    this.busy.set(false);
    this.msg.error(parseApiError(e, fallback).message);
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getUserCard(id).subscribe({
      next: (c) => {
        this.card.set(c);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.card.set(null);
        this.error.set(parseApiError(e, 'Не удалось открыть карточку.').message);
      },
    });
  }
}
