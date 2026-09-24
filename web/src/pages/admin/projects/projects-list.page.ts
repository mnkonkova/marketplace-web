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
import { NzMessageService } from 'ng-zorro-antd/message';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { AdminApi, ManagerInfo } from '@entities/admin/api/admin.api';
import { ProjectApi } from '@entities/project/api/project.api';
import {
  DEFAULT_PROJECT_FILTERS,
  KIND_OPTIONS,
  KindFilter,
  ProjectFilters,
  ProjectsView,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  StatusFilter,
  parseProjectFilters,
  projectFiltersToParams,
  projectFiltersToQuery,
} from '@entities/project/lib/project-filters';
import { AdminProjectsSort, ProjectManagerView } from '@entities/project/model/project.types';
import { AdminSummaryStore } from '@entities/admin/model/admin-summary.store';
import { formatAgo, plural } from '@shared/lib/format';
import { copyToClipboard } from '@shared/lib/clipboard';
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
import { RowMenuComponent, RowMenuItem } from '@shared/ui/row-menu/row-menu.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';
import { ViewSwitchComponent } from '@shared/ui/view-switch/view-switch.component';
import { CreateProjectDialogComponent } from '@features/create-project/create-project.dialog';
import { withFromPage } from '@shared/nav/from-page';
import { AdminBoardComponent } from '@pages/admin/board/board.page';
import { openPanel } from '@shared/lib/panel';
import { NzDrawerService } from 'ng-zorro-antd/drawer';

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
    RowMenuComponent,
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

  private readonly drawer = inject(NzDrawerService);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly msg = inject(NzMessageService);

  private readonly summary = inject(AdminSummaryStore);

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

  // Наборы значений — общие с менеджерской страницей: см.
  // entities/project/lib/project-filters. Вторая копия здесь означала бы,
  // что «Активные» у админа и у менеджера однажды разойдутся.
  public readonly statusOptions = STATUS_OPTIONS;

  public readonly kindOptions = KIND_OPTIONS;

  public readonly sortOptions = SORT_OPTIONS;

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

  public setKind(v: KindFilter): void {
    this.patch({ kind: v, page: 1 });
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
    openPanel(
      { modal: this.modal, drawer: this.drawer },
      {
        title: 'Создать проект',
        content: CreateProjectDialogComponent,
        data: { mode: 'admin' },
        width: 520,
      },
    ).subscribe((created) => {
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
    return projectProgressMeasure(p.kind, p.progress, p.progress_total);
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

  /**
   * Адрес выборки — его и пересылают. Показываем целиком, а не «скопировать
   * ссылку» вслепую: человек должен видеть, что именно уедет в переписку.
   */
  public readonly shareUrl = computed(() => {
    const q = projectFiltersToQuery(this.filters());
    const parts = Object.entries(q)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${v}`);
    return '/admin/projects' + (parts.length ? `?${parts.join('&')}` : '');
  });

  public readonly copied = signal(false);

  public copyShareUrl(): void {
    const url =
      typeof location === 'undefined' ? this.shareUrl() : location.origin + this.shareUrl();
    const ok = copyToClipboard(url);
    this.copied.set(ok);
    if (!ok) this.msg.error('Скопировать не вышло — выделите адрес и скопируйте вручную.');
  }

  /** Прогресс числом: «3 из 5 выкладок» вместо 60%, из которых неясно, из чего. */
  public progressText(p: ProjectManagerView): string {
    if (p.progress_total == null || p.progress_total === 0) return '';
    const unit =
      p.progress_unit === 'publications'
        ? plural(p.progress_total, 'выкладка', 'выкладки', 'выкладок')
        : plural(p.progress_total, 'шаг', 'шага', 'шагов');
    return `${p.progress_done ?? 0} из ${p.progress_total} ${unit}`;
  }

  // ── действия строки ───────────────────────────────────
  public menuFor(p: ProjectManagerView): RowMenuItem[] {
    const out: RowMenuItem[] = [{ code: 'open', label: 'Открыть проект' }];
    // Возврат предлагаем только отменённым: у остальных возвращать нечего,
    // и пункт читался бы как «что-то с проектом не так».
    if (p.status === 'cancelled') {
      out.push({
        code: 'restore',
        label: 'Вернуть проект',
        confirm: `Вернуть «${p.title}» в тот статус, в котором он был до отмены?`,
      });
    }
    out.push(
      p.is_test
        ? { code: 'untest', label: 'Снять пометку «тест»' }
        : {
            code: 'test',
            label: 'Пометить тестовым',
            confirm: `Пометить «${p.title}» тестовым? Из списков он пропадёт, пока их не попросят показать.`,
          },
    );
    return out;
  }

  public onPick(p: ProjectManagerView, code: string): void {
    switch (code) {
      case 'open':
        return this.open(p);
      case 'restore':
        return this.restore(p);
      case 'test':
      case 'untest':
        return this.markTest(p, code === 'test');
    }
  }

  private restore(p: ProjectManagerView): void {
    this.api.adminRestoreProject(p.id).subscribe({
      next: () => {
        this.msg.success('Проект вернулся в работу');
        this.afterChange();
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось вернуть проект').message),
    });
  }

  private markTest(p: ProjectManagerView, isTest: boolean): void {
    this.api.adminMarkProjectTest(p.id, isTest).subscribe({
      next: () => {
        this.msg.success(isTest ? 'Помечен тестовым' : 'Пометка снята');
        this.afterChange();
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось изменить пометку').message),
    });
  }

  /** Набор изменился — перечитываем список и счётчик в сайдбаре. */
  private afterChange(): void {
    this.fetch(this.filters());
    this.summary.reload();
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
