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
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzModalService } from 'ng-zorro-antd/modal';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { AdminApi, ManagerInfo } from '@entities/admin/api/admin.api';
import { ProjectApi } from '@entities/project/api/project.api';
import {
  DEFAULT_PROJECT_FILTERS,
  ProjectFilters,
  ProjectsView,
  StatusFilter,
  parseProjectFilters,
  projectFiltersToParams,
  projectFiltersToQuery,
} from '@entities/project/lib/project-filters';
import { AdminProjectsSort, ProjectManagerView } from '@entities/project/model/project.types';
import { formatAgo } from '@shared/lib/format';
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  ProgressMeasure,
  projectProgressMeasure,
  projectStageLabel,
} from '@shared/lib/project-status';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';
import { ViewSwitchComponent } from '@shared/ui/view-switch/view-switch.component';
import { CreateProjectDialogComponent } from '@features/create-project/create-project.dialog';
import { withFromPage } from '@shared/nav/from-page';
import { AdminBoardComponent } from '@pages/admin/board/board.page';

/**
 * Все проекты площадки: список или канбан, фильтры — в адресе.
 *
 * Канбан переехал сюда с `/admin/board`: это не соседний раздел, а второй
 * взгляд на тот же набор, и в сайдбаре он занимал пункт наравне с
 * «Проектами», хотя отвечает на тот же вопрос.
 *
 * Фильтрация остаётся серверной. В адресе лежит ровно то, что уходит в
 * `GET /admin/projects`, — чтобы ссылку на выборку можно было переслать,
 * а F5 не сбрасывал её в чистый список (см. entities/project/lib).
 */
@Component({
  selector: 'app-admin-projects-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzProgressModule,
    NzButtonModule,
    NzInputModule,
    NzSelectModule,
    NzCheckboxModule,
    ListStateComponent,
    PageHeadComponent,
    StatusTagComponent,
    ViewSwitchComponent,
    AdminBoardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-list.page.html',
  styleUrl: './projects-list.page.scss',
})
export class AdminProjectsListPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly adminApi = inject(AdminApi);

  private readonly modal = inject(NzModalService);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  public readonly items = signal<ProjectManagerView[]>([]);

  public readonly total = signal(0);

  public readonly loading = signal(false);

  public readonly error = signal<string | null>(null);

  public readonly managers = signal<ManagerInfo[]>([]);

  /** Фильтры читаются из адреса — он здесь единственный источник правды. */
  public readonly filters = computed<ProjectFilters>(() => parseProjectFilters(this.queryParams()));

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  /** Что набрано в поле поиска. В адрес уезжает через debounce. */
  public q = '';

  public readonly boardSubtitle =
    'Канбан собирается по всем проектам сразу — фильтры списка на нём не действуют.';

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

  /** Поиск с debounce — иначе запрос уходит на каждый символ. */
  private readonly search$ = new Subject<string>();

  public constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged()).subscribe((q) => {
      this.patch({ q, page: 1 });
    });
    // Адрес поменялся — перечитываем список. Это же покрывает «назад» в
    // браузере: страница возвращается в то состояние, в котором её
    // оставили, а не в начальное.
    effect(() => {
      const f = this.filters();
      // Канбан просит свой набор целиком и сам; списку он не нужен.
      if (f.view === 'board') return;
      this.fetch(f);
    });
  }

  public ngOnInit(): void {
    this.q = this.filters().q;
    // Список менеджеров нужен только для выпадашки фильтра. Не доехал —
    // страница работает, просто без фильтра по ответственному.
    this.adminApi.listManagers(true).subscribe({
      next: (r) => this.managers.set(r.items ?? []),
      error: () => this.managers.set([]),
    });
  }

  /** Фильтры лежат в адресе — про это и говорит подзаголовок раздела. */
  public readonly listSubtitle =
    'Все проекты площадки. Фильтры остаются в адресе — ссылкой на выборку можно поделиться.';

  public onSearch(): void {
    this.search$.next(this.q.trim());
  }

  // Смена фильтра возвращает на первую страницу: остаться на пятой при
  // сузившемся наборе значит увидеть пустую таблицу вместо результата.
  public setStatus(v: StatusFilter): void {
    this.patch({ status: v, page: 1 });
  }

  public setManager(v: string): void {
    this.patch({ manager: v, page: 1 });
  }

  public setSort(v: AdminProjectsSort): void {
    this.patch({ sort: v, page: 1 });
  }

  public setIncludeTest(v: boolean): void {
    this.patch({ includeTest: v, page: 1 });
  }

  public setView(v: ProjectsView): void {
    this.patch({ view: v });
  }

  // nz-table эмитит query params при смене страницы/размера. Offset
  // считаем сами — бэк принимает limit/offset, а не номер страницы.
  public onQueryParamsChange(p: NzTableQueryParams): void {
    const f = this.filters();
    if (p.pageIndex !== f.page || p.pageSize !== f.pageSize) {
      this.patch({ page: p.pageIndex, pageSize: p.pageSize });
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
      if (created) this.fetch(this.filters());
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

  public statusTone(s: ProjectManagerView['display_status']): StatusTone {
    return PROJECT_STATUS_TONE[s];
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

  public retry(): void {
    this.fetch(this.filters());
  }

  /** Записать изменение фильтра в адрес. Список перечитается сам. */
  private patch(part: Partial<ProjectFilters>): void {
    const next = { ...DEFAULT_PROJECT_FILTERS, ...this.filters(), ...part };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: projectFiltersToQuery(next),
      queryParamsHandling: 'merge',
      // Каждая правка фильтра — не отдельный шаг истории: «назад» после
      // трёх кликов по селектам должно возвращать на прошлую страницу, а
      // не разбирать их по одному.
      replaceUrl: true,
    });
  }

  private fetch(f: ProjectFilters): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.adminListProjects(projectFiltersToParams(f)).subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.total.set(r.total ?? 0);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.items.set([]);
        this.error.set(parseApiError(e, 'Не удалось загрузить список проектов.').message);
      },
    });
  }
}
