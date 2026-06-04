import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { forkJoin } from 'rxjs';

import { ProjectApi } from '@entities/project/api/project.api';
import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import { Pipeline } from '@entities/pipeline/model/pipeline.types';
import { ProjectManagerView, ProjectDisplayStatus } from '@entities/project/model/project.types';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

interface FunnelStats {
  pipeline: Pipeline;
  total: number;
  new: number;
  active: number;
  waiting: number;
  onHold: number;
  completed: number;
  cancelled: number;
}

const BUCKETS: Record<ProjectDisplayStatus, keyof Omit<FunnelStats, 'pipeline' | 'total'>> = {
  not_started: 'new',
  in_progress: 'active',
  waiting_action: 'waiting',
  on_hold: 'onHold',
  completed: 'completed',
  cancelled: 'cancelled',
};

@Component({
  selector: 'app-admin-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink, NzSpinModule, NzEmptyModule, AdminLayoutComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardPage implements OnInit {
  private readonly projectApi = inject(ProjectApi);
  private readonly pipelineApi = inject(PipelineApi);

  public readonly loading = signal(true);
  public readonly pipelines = signal<Pipeline[]>([]);
  public readonly projects = signal<ProjectManagerView[]>([]);

  public readonly stats = computed<FunnelStats[]>(() => {
    const byID = new Map<string, FunnelStats>();
    for (const pl of this.pipelines()) {
      byID.set(pl.id, {
        pipeline: pl,
        total: 0,
        new: 0,
        active: 0,
        waiting: 0,
        onHold: 0,
        completed: 0,
        cancelled: 0,
      });
    }
    for (const p of this.projects()) {
      const s = byID.get(p.pipeline_id);
      if (!s) continue; // проект на удалённой/неактивной воронке — игнорим
      s.total++;
      const bucket = BUCKETS[p.display_status];
      if (bucket) s[bucket]++;
    }
    return [...byID.values()].sort((a, b) => b.total - a.total);
  });

  public readonly totals = computed(() => {
    const acc = { total: 0, new: 0, active: 0, waiting: 0, onHold: 0, completed: 0, cancelled: 0 };
    for (const s of this.stats()) {
      acc.total += s.total;
      acc.new += s.new;
      acc.active += s.active;
      acc.waiting += s.waiting;
      acc.onHold += s.onHold;
      acc.completed += s.completed;
      acc.cancelled += s.cancelled;
    }
    return acc;
  });

  public ngOnInit(): void {
    forkJoin({
      pipelines: this.pipelineApi.list(),
      projects: this.projectApi.adminListProjects(),
    }).subscribe({
      next: ({ pipelines, projects }) => {
        this.pipelines.set(pipelines.items ?? []);
        this.projects.set(projects.items ?? []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
