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
  /** % завершения = completed / (completed + cancelled). null если не из чего считать. */
  conversionPct: number | null;
  /** Средний лид-тайм по завершённым в днях. null если завершённых нет. */
  avgLeadDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_THRESHOLD_DAYS = 7;

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
    // Накопители для среднего лид-тайма (sum/count, считаем сразу).
    const leadSumByPipeline = new Map<string, { sum: number; count: number }>();

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
        conversionPct: null,
        avgLeadDays: null,
      });
      leadSumByPipeline.set(pl.id, { sum: 0, count: 0 });
    }
    for (const p of this.projects()) {
      const s = byID.get(p.pipeline_id);
      if (!s) continue; // проект на удалённой/неактивной воронке — игнорим
      s.total++;
      const bucket = BUCKETS[p.display_status];
      if (bucket) s[bucket]++;

      // Лид-тайм: считаем только для завершённых, где есть оба таймстампа.
      if (p.display_status === 'completed' && p.started_at && p.completed_at) {
        const days = (Date.parse(p.completed_at) - Date.parse(p.started_at)) / DAY_MS;
        if (Number.isFinite(days) && days >= 0) {
          const acc = leadSumByPipeline.get(p.pipeline_id)!;
          acc.sum += days;
          acc.count++;
        }
      }
    }

    // Финализируем conversion + avg lead.
    for (const s of byID.values()) {
      const closed = s.completed + s.cancelled;
      s.conversionPct = closed > 0 ? Math.round((s.completed / closed) * 100) : null;
      const lead = leadSumByPipeline.get(s.pipeline.id)!;
      s.avgLeadDays = lead.count > 0 ? Math.round(lead.sum / lead.count) : null;
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

  /** Вторичные операционные метрики — выявляют проблемы, требующие
   *  внимания админа. Считаются по сырому projects(), не зависят от pipeline. */
  public readonly health = computed(() => {
    const now = Date.now();
    let orphans = 0;       // активные проекты без менеджера
    let stuck = 0;         // активные, updated_at старше STUCK_THRESHOLD_DAYS
    let overRevisions = 0; // revisions_used > revisions_included

    for (const p of this.projects()) {
      const isOpen = p.display_status !== 'completed' && p.display_status !== 'cancelled';
      if (isOpen) {
        if (!p.assigned_to_user_id) orphans++;
        if (p.updated_at) {
          const idleDays = (now - Date.parse(p.updated_at)) / DAY_MS;
          if (idleDays >= STUCK_THRESHOLD_DAYS) stuck++;
        }
      }
      if (p.revisions_included > 0 && p.revisions_used > p.revisions_included) {
        overRevisions++;
      }
    }

    // Общий лид-тайм по всем завершённым (агрегат поверх воронок).
    let leadSum = 0;
    let leadCount = 0;
    for (const p of this.projects()) {
      if (p.display_status === 'completed' && p.started_at && p.completed_at) {
        const days = (Date.parse(p.completed_at) - Date.parse(p.started_at)) / DAY_MS;
        if (Number.isFinite(days) && days >= 0) {
          leadSum += days;
          leadCount++;
        }
      }
    }
    const avgLead = leadCount > 0 ? Math.round(leadSum / leadCount) : null;

    return { orphans, stuck, overRevisions, avgLead };
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
