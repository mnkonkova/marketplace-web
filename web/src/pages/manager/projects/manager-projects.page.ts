import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectKind, ProjectManagerView } from '@entities/project/model/project.types';
import { ProjectsView, parseProjectFilters } from '@entities/project/lib/project-filters';
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
  production_turnkey: 'Продакшен под ключ',
  general: 'Общий проект',
};

/**
 * Проекты менеджера: список или канбан.
 *
 * Канбан показывает только то, у чего есть воронка, — а у проекта с
 * креаторами её нет вовсе: вместо шагов у него план выкладок. Поэтому
 * список остаётся видом по умолчанию: он единственный, где виден весь
 * набор, а канбан — второй взгляд на его часть.
 */
@Component({
  selector: 'app-manager-projects',
  standalone: true,
  imports: [
    CommonModule,
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

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  /** Вид живёт в адресе — ссылка «канбаном» открывается канбаном. */
  public readonly view = computed<ProjectsView>(() => parseProjectFilters(this.queryParams()).view);

  /** Фильтр по виду: «Все» плюс те виды, что реально есть в списке. */
  public readonly kind = signal<ProjectKind | 'all'>('all');

  public readonly kinds = computed<ProjectKind[]>(() => {
    const seen = new Set(this.items().map((p) => p.kind));
    return (Object.keys(KIND_LABEL) as ProjectKind[]).filter((k) => seen.has(k));
  });

  public readonly visible = computed(() => {
    const k = this.kind();
    return k === 'all' ? this.items() : this.items().filter((p) => p.kind === k);
  });

  public ngOnInit(): void {
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

  public setKind(k: ProjectKind | 'all'): void {
    this.kind.set(k);
  }

  public setView(v: ProjectsView): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: v === 'board' ? 'board' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public open(p: ProjectManagerView): void {
    void this.router.navigate(['/manager/projects', p.id], withFromPage(this.router));
  }

  public statusTone(s: ProjectManagerView['display_status']): StatusTone {
    return PROJECT_STATUS_TONE[s];
  }

  /**
   * Чем проект живёт сейчас. У проекта с воронкой это шаг, у проекта с
   * креаторами шагов нет — там осмысленна доля закрытых выкладок,
   * которую бэк уже считает в progress.
   */
  public where(p: ProjectManagerView): string {
    if (p.kind === 'creators_turnkey') return `${p.progress}% выкладок закрыто`;
    return p.current_step_title || p.current_stage_name || '—';
  }
}
