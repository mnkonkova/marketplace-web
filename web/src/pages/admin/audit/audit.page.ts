import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NzTableModule, NzTableQueryParams } from 'ng-zorro-antd/table';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { AdminApi } from '@entities/admin/api/admin.api';
import { AuditEntry } from '@entities/admin/model/admin-shell.types';
import {
  AUDIT_ACTION_LABEL,
  AUDIT_ACTION_OPTIONS,
  AUDIT_OBJECT_LABEL,
  AUDIT_OBJECT_OPTIONS,
} from '@entities/admin/lib/audit-labels';
import {
  AuditFilters,
  DEFAULT_AUDIT_FILTERS,
  auditFiltersToParams,
  auditFiltersToQuery,
  parseAuditFilters,
} from '@entities/admin/lib/audit-filters';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';

/**
 * Журнал: кто что менял.
 *
 * До него разбор спорного случая шёл в логи сервера — то есть к тому, у
 * кого есть доступ к серверу. «Кто снял роль у менеджера» и «когда
 * выпустили эту версию прайса» — вопросы админа, и отвечать на них
 * должен админский экран.
 *
 * Фильтры и страница живут в адресе: ссылку «вот что делали с этим
 * проектом» пересылают, а не пересказывают.
 */
@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzSelectModule,
    ListStateComponent,
    PageHeadComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit.page.html',
  styleUrl: './audit.page.scss',
})
export class AdminAuditPage implements OnInit {
  private readonly api = inject(AdminApi);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  public readonly items = signal<AuditEntry[]>([]);

  public readonly total = signal(0);

  public readonly loading = signal(false);

  public readonly error = signal<string | null>(null);

  public readonly actionOptions = AUDIT_ACTION_OPTIONS;

  public readonly objectOptions = AUDIT_OBJECT_OPTIONS;

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  public readonly filters = computed<AuditFilters>(() => parseAuditFilters(this.queryParams()));

  /** Фильтр по объекту сузили до одной записи — скажем об этом словами. */
  public readonly narrowed = computed(() => !!this.filters().objectId);

  public constructor() {
    effect(() => this.fetch(this.filters()));
  }

  public ngOnInit(): void {
    // Ничего: список тянет effect по адресу — он же покрывает «назад».
  }

  public setAction(v: string): void {
    this.patch({ action: v, page: 1 });
  }

  public setObjectType(v: string): void {
    this.patch({ objectType: v, page: 1 });
  }

  public clearObject(): void {
    this.patch({ objectId: '', page: 1 });
  }

  public onQueryParamsChange(p: NzTableQueryParams): void {
    const f = this.filters();
    if (p.pageIndex !== f.page || p.pageSize !== f.pageSize) {
      this.patch({ page: p.pageIndex, pageSize: p.pageSize });
    }
  }

  public retry(): void {
    this.fetch(this.filters());
  }

  public actorName(e: AuditEntry): string {
    // Пустой актор — не человек: фоновая задача или вызов мимо HTTP.
    return e.actor_display_name || e.actor_email || 'Система';
  }

  public actionLabel(e: AuditEntry): string {
    return AUDIT_ACTION_LABEL[e.action] ?? e.action;
  }

  public objectLabel(e: AuditEntry): string {
    return AUDIT_OBJECT_LABEL[e.object_type] ?? e.object_type;
  }

  /**
   * Подробности действия — то, что легло в payload. Показываем парами
   * «ключ: значение»: своего словаря у полей нет, и выдумывать его на
   * каждое новое действие дороже, чем показать как есть.
   */
  public details(e: AuditEntry): string {
    const p = e.payload;
    if (!p) return '';
    const parts = Object.entries(p)
      .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
      .map(([k, v]) => `${k}: ${v}`);
    return parts.join(' · ');
  }

  private patch(part: Partial<AuditFilters>): void {
    const next = { ...DEFAULT_AUDIT_FILTERS, ...this.filters(), ...part };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: auditFiltersToQuery(next),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private fetch(f: AuditFilters): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listAudit(auditFiltersToParams(f)).subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.total.set(r.total ?? 0);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.items.set([]);
        this.error.set(parseApiError(e, 'Не удалось загрузить журнал.').message);
      },
    });
  }
}
