import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectKind, ProjectManagerView } from '@entities/project/model/project.types';
import { PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { parseApiError } from '@shared/api/api-error';
import { withFromPage } from '@shared/nav/from-page';
import { ManagerLayoutComponent } from '@widgets/manager-layout/manager-layout.component';

const KIND_LABEL: Record<ProjectKind, string> = {
  creators_turnkey: 'Креаторы под ключ',
  production_turnkey: 'Продакшен под ключ',
  general: 'Общий проект',
};

/**
 * Проекты менеджера списком.
 *
 * Канбан показывает только то, у чего есть воронка, — а у проекта с
 * креаторами её нет вовсе: вместо шагов у него план выкладок. До этого
 * списка такие проекты были недостижимы: менеджер видел их в «Заявках»
 * ровно один раз, пока не взял на себя, и дальше терял.
 */
@Component({
  selector: 'app-manager-projects',
  standalone: true,
  imports: [CommonModule, ManagerLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-projects.page.html',
  styleUrl: './manager-projects.page.scss',
})
export class ManagerProjectsPage implements OnInit {
  private readonly api = inject(ProjectApi);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly items = signal<ProjectManagerView[]>([]);

  public readonly kindLabel = KIND_LABEL;

  public readonly statusLabel = PROJECT_STATUS_LABEL;

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
    this.api.managerAssigned().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить проекты.').message);
      },
    });
  }

  public setKind(k: ProjectKind | 'all'): void {
    this.kind.set(k);
  }

  public open(p: ProjectManagerView): void {
    void this.router.navigate(['/manager/projects', p.id], withFromPage(this.router));
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
