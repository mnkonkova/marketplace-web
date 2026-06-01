import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  CdkDragDrop,
  CdkDropList,
  CdkDrag,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';

import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import {
  PipelineFull,
  PipelineStageFull,
  PipelineStep,
} from '@entities/pipeline/model/pipeline.types';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

@Component({
  selector: 'app-admin-pipeline-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CdkDropList,
    CdkDrag,
    NzButtonModule,
    NzInputModule,
    NzInputNumberModule,
    NzSelectModule,
    NzSwitchModule,
    NzSpinModule,
    NzPopconfirmModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pipeline-editor.page.html',
  styleUrl: './pipeline-editor.page.scss',
})
export class AdminPipelineEditorPage implements OnInit {
  private readonly api = inject(PipelineApi);

  private readonly route = inject(ActivatedRoute);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly pipeline = signal<PipelineFull | null>(null);

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.fetch(id);
  }

  public addStage(): void {
    const p = this.pipeline();
    if (!p) return;
    this.api.addStage(p.id, { name: 'Новая стадия', sort_order: p.stages.length }).subscribe({
      next: () => this.fetch(p.id),
    });
  }

  public deleteStage(s: PipelineStageFull): void {
    const p = this.pipeline();
    if (!p) return;
    this.api.deleteStage(s.id).subscribe({
      next: () => {
        this.msg.success('Удалено');
        this.fetch(p.id);
      },
    });
  }

  public addStep(stage: PipelineStageFull): void {
    const p = this.pipeline();
    if (!p) return;
    this.api
      .addStep(stage.id, {
        name: 'Новый шаг',
        owner: 'team',
        duration_days: 1,
        visible_to_client: true,
        visible_to_specialist: true,
        weight: 1,
        sort_order: stage.steps.length,
        is_review: false,
      })
      .subscribe({
        next: () => this.fetch(p.id),
      });
  }

  public deleteStep(step: PipelineStep): void {
    const p = this.pipeline();
    if (!p) return;
    this.api.deleteStep(step.id).subscribe({
      next: () => this.fetch(p.id),
    });
  }

  public saveStage(stage: PipelineStageFull): void {
    this.api.patchStage(stage.id, { name: stage.name }).subscribe({
      next: () => this.msg.success('Сохранено'),
    });
  }

  public saveStep(step: PipelineStep): void {
    this.api
      .patchStep(step.id, {
        name: step.name,
        owner: step.owner,
        duration_days: step.duration_days,
        visible_to_client: step.visible_to_client,
        visible_to_specialist: step.visible_to_specialist,
        weight: step.weight,
        is_review: step.is_review,
      })
      .subscribe({ next: () => this.msg.success('Сохранено') });
  }

  public reorderStages(event: CdkDragDrop<PipelineStageFull[]>): void {
    const p = this.pipeline();
    if (!p) return;
    moveItemInArray(p.stages, event.previousIndex, event.currentIndex);
    this.pipeline.set({ ...p, stages: [...p.stages] });
    this.persistOrder();
  }

  public reorderSteps(event: CdkDragDrop<PipelineStep[]>, stage: PipelineStageFull): void {
    moveItemInArray(stage.steps, event.previousIndex, event.currentIndex);
    this.persistOrder();
  }

  private persistOrder(): void {
    const p = this.pipeline();
    if (!p) return;
    const stages = p.stages.map((s, i) => ({
      id: s.id,
      sort_order: i,
      steps: s.steps.map((st, j) => ({ id: st.id, sort_order: j })),
    }));
    this.api.reorder(p.id, stages).subscribe({
      next: () => this.msg.success('Порядок сохранён'),
      error: () => this.msg.error('Не удалось сохранить порядок'),
    });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.api.get(id).subscribe({
      next: (p) => {
        this.pipeline.set(p);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
