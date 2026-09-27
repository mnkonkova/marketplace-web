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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

import { ProjectApi } from '@entities/project/api/project.api';
import {
  AdminProjectsSort,
  ProjectKind,
  ProjectManagerView,
} from '@entities/project/model/project.types';
import {
  DEFAULT_PROJECT_FILTERS,
  KIND_OPTIONS,
  KindFilter,
  MANAGER_STATUS_OPTIONS,
  ProjectFilters,
  ProjectsView,
  SORT_OPTIONS,
  StatusFilter,
  parseProjectFilters,
  projectFiltersToQuery,
  selectProjects,
} from '@entities/project/lib/project-filters';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '@shared/lib/project-status';
import { parseApiError } from '@shared/api/api-error';
import { withFromPage } from '@shared/nav/from-page';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { StatusTagComponent, StatusTone } from '@shared/ui/status-tag/status-tag.component';
import { ViewSwitchComponent } from '@shared/ui/view-switch/view-switch.component';
import { ManagerBoardComponent } from '@pages/manager/board/board.page';

const KIND_LABEL: Record<ProjectKind, string> = {
  creators_turnkey: 'Креаторы под ключ',
  brand_turnkey: 'Бренд под ключ',
  production_turnkey: 'Продакшен под ключ',
  general: 'Общий проект',
};

/**
 * Проекты менеджера: список или канбан, фильтры — в адресе.
 *
 * Канбан показывает только то, у чего есть воронка, — а у проекта с
 * креаторами её нет вовсе: вместо шагов у него план выкладок. Поэтому
 * список остаётся видом по умолчанию: он единственный, где виден весь
 * набор, а канбан — второй взгляд на его часть.
 *
 * Фильтры те же, что у админа, и разбираются тем же кодом
 * (entities/project/lib/project-filters): адрес читается одной функцией,
 * отбор идёт одной функцией, наборы значений общие. Своей копии фильтров
 * здесь нет намеренно — разойдутся.
 *
 * Отличие от админа одно, и оно временное: `GET /manager/projects` не
 * принимает параметров и отдаёт весь закреплённый набор разом, поэтому
 * отбирает `selectProjects` на месте. Как только у ручки появятся
 * параметры, `fetch` начнёт слать `projectFiltersToParams(f)`, а
 * `visible()` станет просто `items()` — разметку это не трогает. Там же,
 * в project-filters, описана граница: клиентский отбор честен ровно
 * пока ручка отдаёт ВЕСЬ набор, а не страницу.
 *
 * Фильтра по менеджеру здесь нет и быть не должно: ручка и так отдаёт
 * только свои проекты, и выпадашка «Все менеджеры» обещала бы чужие.
 */
@Component({
  selector: 'app-manager-projects',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzInputModule,
    NzSelectModule,
    NzCheckboxModule,
    ListStateComponent,
    PageHeadComponent,
    StatusTagComponent,
    ViewSwitchComponent,
    ManagerBoardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-projects.page.html',
  styleUrl: './manager-projects.page.scss',
})
export class ManagerProjectsPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  public readonly loading = signal(true);

  public readonly error = signal<string | null>(null);

  public readonly items = signal<ProjectManagerView[]>([]);

  public readonly kindLabel = KIND_LABEL;

  public readonly statusLabel = PROJECT_STATUS_LABEL;

  public readonly statusOptions = MANAGER_STATUS_OPTIONS;

  public readonly kindOptions = KIND_OPTIONS;

  public readonly sortOptions = SORT_OPTIONS;

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  /** Фильтры читаются из адреса — он здесь единственный источник правды. */
  public readonly filters = computed<ProjectFilters>(() => parseProjectFilters(this.queryParams()));

  /** Вид живёт в адресе — ссылка «канбаном» открывается канбаном. */
  public readonly view = computed<ProjectsView>(() => this.filters().view);

  /** Что набрано в поле поиска. В адрес уезжает через debounce. */
  public q = '';

  /** Строки под текущими фильтрами. Пагинации у ручки нет — считаем все. */
  public readonly visible = computed(() => selectProjects(this.items(), this.filters()));

  /** Поиск с debounce — иначе адрес переписывается на каждый символ. */
  private readonly search$ = new Subject<string>();

  public constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged()).subscribe((q) => {
      this.patch({ q });
    });
  }

  public ngOnInit(): void {
    this.q = this.filters().q;
    this.fetch();
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.managerAssigned().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить проекты.').message);
      },
    });
  }

  public onSearch(): void {
    this.search$.next(this.q.trim());
  }

  public setStatus(v: StatusFilter): void {
    this.patch({ status: v });
  }

  public setKind(v: KindFilter): void {
    this.patch({ kind: v });
  }

  public setSort(v: AdminProjectsSort): void {
    this.patch({ sort: v });
  }

  public setIncludeTest(v: boolean): void {
    this.patch({ includeTest: v });
  }

  public setView(v: ProjectsView): void {
    this.patch({ view: v });
  }

  public open(p: ProjectManagerView): void {
    void this.router.navigate(['/manager/projects', p.id], withFromPage(this.router));
  }

  public statusTone(s: ProjectManagerView['display_status']): StatusTone {
    return PROJECT_STATUS_TONE[s];
  }

  /**
   * Чем проект живёт сейчас. У проекта с воронкой это шаг, у проекта с
   * планом выкладок (креаторы или бренд) шагов нет — там осмысленна доля
   * закрытых выкладок.
   *
   * Числом, а не процентом: «100% выкладок закрыто» на проекте, где дат
   * ещё не проставили, — чистое враньё (нечего закрывать, а звучит как
   * «всё сделано»). Считаем по progress_done/progress_total, которые бэк
   * отдаёт рядом с процентом, и при пустом плане говорим об этом прямо.
   */
  public where(p: ProjectManagerView): string {
    const hasPlan = p.kind === 'creators_turnkey' || p.kind === 'brand_turnkey';
    if (!hasPlan) return p.current_step_title || p.current_stage_name || '—';
    if (!p.progress_total) return 'дат в плане нет';
    return `${p.progress_done ?? 0} из ${p.progress_total} по плану периода`;
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
}
