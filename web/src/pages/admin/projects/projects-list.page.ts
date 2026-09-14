import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzTableModule, NzTableQueryParams } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { AdminApi, ManagerInfo } from '@entities/admin/api/admin.api';
import { AdminProjectsParams, ProjectApi } from '@entities/project/api/project.api';
import {
  AdminProjectsSort,
  ProjectManagerView,
  ProjectStatus,
} from '@entities/project/model/project.types';
import { formatAgo } from '@shared/lib/format';
import {
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  ProgressMeasure,
  projectProgressMeasure,
  projectStageLabel,
} from '@shared/lib/project-status';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';
import { CreateProjectDialogComponent } from '@features/create-project/create-project.dialog';
import { withFromPage } from '@shared/nav/from-page';

// '' = без фильтра. Фильтруем по status проекта, а не по display_status:
// второй вычисляется из шагов и в SQL его нет.
type StatusFilter = '' | ProjectStatus;

// 'none' — проекты без ответственного. Пустым значением это не выразить:
// пустое значит «любой менеджер».
type ManagerFilter = '' | 'none' | string;

@Component({
  selector: 'app-admin-projects-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzTagModule,
    NzProgressModule,
    NzButtonModule,
    NzInputModule,
    NzSelectModule,
    NzCheckboxModule,
    NzEmptyModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-list.page.html',
  styleUrl: './projects-list.page.scss',
})
export class AdminProjectsListPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly adminApi = inject(AdminApi);

  private readonly modal = inject(NzModalService);

  private readonly msg = inject(NzMessageService);

  private readonly router = inject(Router);

  public readonly items = signal<ProjectManagerView[]>([]);

  public readonly total = signal(0);

  public readonly loading = signal(false);

  public readonly pageIndex = signal(1);

  public readonly pageSize = signal(20);

  public readonly managers = signal<ManagerInfo[]>([]);

  public q = '';

  public status: StatusFilter = '';

  public manager: ManagerFilter = '';

  // По умолчанию — самые давно обновлённые сверху. Список открывают
  // ровно с этим вопросом: что не двигалось и кто за это отвечает.
  public sort: AdminProjectsSort = 'updated_asc';

  // Тестовые проекты по умолчанию скрыты: из-за них половина списка была
  // «тест т8т 1234», и настоящие проекты в нём терялись.
  public includeTest = false;

  public readonly statusOptions: { value: StatusFilter; label: string }[] = [
    { value: '', label: 'Все статусы' },
    { value: 'draft', label: 'Черновик' },
    { value: 'active', label: 'В работе' },
    { value: 'on_hold', label: 'На паузе' },
    { value: 'dispute', label: 'Спор' },
    { value: 'done', label: 'Завершён' },
    { value: 'cancelled', label: 'Отменён' },
  ];

  public readonly sortOptions: { value: AdminProjectsSort; label: string }[] = [
    { value: 'updated_asc', label: 'Давно не двигались' },
    { value: 'updated_desc', label: 'Недавно обновлённые' },
    { value: 'created_desc', label: 'Сначала новые' },
    { value: 'created_asc', label: 'Сначала старые' },
  ];

  // Поиск с debounce — иначе запрос уходит на каждый символ.
  private readonly search$ = new Subject<string>();

  public constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
      this.pageIndex.set(1);
      this.fetch();
    });
  }

  public ngOnInit(): void {
    this.fetch();
    // Список менеджеров нужен только для выпадашки фильтра. Не доехал —
    // страница работает, просто без фильтра по ответственному.
    this.adminApi.listManagers(true).subscribe({
      next: (r) => this.managers.set(r.items ?? []),
      error: () => this.managers.set([]),
    });
  }

  public onSearch(): void {
    this.search$.next(this.q.trim());
  }

  // Смена фильтра возвращает на первую страницу: остаться на пятой при
  // сузившемся наборе значит увидеть пустую таблицу вместо результата.
  public onFilterChange(): void {
    this.pageIndex.set(1);
    this.fetch();
  }

  // nz-table эмитит query params при смене страницы/размера. Offset
  // считаем сами — бэк принимает limit/offset, а не номер страницы.
  public onQueryParamsChange(p: NzTableQueryParams): void {
    if (p.pageIndex !== this.pageIndex() || p.pageSize !== this.pageSize()) {
      this.pageIndex.set(p.pageIndex);
      this.pageSize.set(p.pageSize);
      this.fetch();
    }
  }

  public openCreate(): void {
    const ref = this.modal.create({
      nzTitle: 'Создать проект',
      nzContent: CreateProjectDialogComponent,
      nzFooter: null,
      nzWidth: 520,
      nzData: { mode: 'admin' },
    });
    ref.afterClose.subscribe((created) => {
      if (created) this.fetch();
    });
  }

  // Открываем в той же вкладке: from_page возвращает назад по «К списку»,
  // а новая вкладка теряет и историю, и место в списке.
  public open(p: ProjectManagerView): void {
    void this.router.navigate(['/manager/projects', p.id], withFromPage(this.router));
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public progress(p: ProjectManagerView): ProgressMeasure {
    return projectProgressMeasure(p.kind, p.progress);
  }

  public stageLabel(p: ProjectManagerView): string {
    return projectStageLabel(p.kind, p.current_stage_name);
  }

  public ago(iso: string): string {
    return formatAgo(iso);
  }

  private fetch(): void {
    this.loading.set(true);
    const params: AdminProjectsParams = {
      sort: this.sort,
      limit: this.pageSize(),
      offset: (this.pageIndex() - 1) * this.pageSize(),
    };
    // Короче двух символов сервер всё равно игнорирует — не шлём, чтобы
    // в запросе не было параметра, который ни на что не влияет.
    const q = this.q.trim();
    if (q.length >= 2) params.q = q;
    if (this.status) params.status = this.status;
    if (this.manager) params.manager = this.manager;
    if (this.includeTest) params.include_test = true;
    this.api.adminListProjects(params).subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.total.set(r.total ?? 0);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.msg.error('Не удалось загрузить список проектов');
      },
    });
  }
}
