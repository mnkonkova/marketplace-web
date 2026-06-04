import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

import { ProjectApi } from '@entities/project/api/project.api';
import { Pipeline } from '@entities/pipeline/model/pipeline.types';

export interface ChangeFunnelDialogData {
  projectId: string;
  projectTitle: string;
  currentPipelineId: string;
  pipelines: Pipeline[];
}

export interface ChangeFunnelDialogResult {
  pipelineId: string;
}

@Component({
  selector: 'app-change-funnel-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, NzSelectModule, NzButtonModule, NzAlertModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="warn">
      <strong>Прогресс проекта сбросится:</strong> текущие шаги и стадии будут
      удалены, новая воронка инстанциируется с нуля. Использованные правки
      обнулятся, started_at пересчитается.
    </p>

    <label class="field">
      <span>Новая воронка</span>
      <nz-select
        nzPlaceHolder="Выберите воронку"
        [ngModel]="selectedPipelineId()"
        (ngModelChange)="selectedPipelineId.set($event)"
        style="width: 100%"
      >
        @for (p of availablePipelines(); track p.id) {
          <nz-option [nzValue]="p.id" [nzLabel]="p.name + (p.is_default ? ' (по умолчанию)' : '')"></nz-option>
        }
      </nz-select>
    </label>

    @if (error()) {
      <nz-alert nzType="error" [nzMessage]="error()" nzShowIcon class="error" />
    }

    <div class="footer">
      <button nz-button type="button" (click)="cancel()">Отмена</button>
      <button
        nz-button
        nzType="primary"
        nzDanger
        [disabled]="!selectedPipelineId() || saving()"
        [nzLoading]="saving()"
        (click)="confirm()"
      >
        Сменить воронку
      </button>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 16px; }
    .warn {
      margin: 0;
      padding: 12px 14px;
      border-radius: 8px;
      background: rgba(255, 122, 122, 0.08);
      border: 1px solid rgba(255, 122, 122, 0.25);
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
      strong { color: #ff7a7a; }
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .error { margin: 0; }
    .footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `],
})
export class ChangeFunnelDialog {
  private readonly modalRef = inject<NzModalRef<ChangeFunnelDialog, ChangeFunnelDialogResult | null>>(NzModalRef);
  private readonly data = inject<ChangeFunnelDialogData>(NZ_MODAL_DATA);
  private readonly projectApi = inject(ProjectApi);
  private readonly msg = inject(NzMessageService);

  public readonly selectedPipelineId = signal<string>('');
  public readonly saving = signal(false);
  public readonly error = signal('');

  /** Текущая воронка исключается — менять «на ту же» бессмысленно. */
  public readonly availablePipelines = computed(() =>
    this.data.pipelines.filter((p) => p.is_active && p.id !== this.data.currentPipelineId),
  );

  public cancel(): void {
    this.modalRef.close(null);
  }

  public confirm(): void {
    const pid = this.selectedPipelineId();
    if (!pid) return;
    this.saving.set(true);
    this.error.set('');
    this.projectApi.adminChangeFunnel(this.data.projectId, pid).subscribe({
      next: () => {
        this.msg.success('Воронка изменена. Прогресс сброшен.');
        this.modalRef.close({ pipelineId: pid });
      },
      error: (err) => {
        this.saving.set(false);
        const e = err?.error as { error?: string; message?: string } | undefined;
        this.error.set(e?.message || e?.error || 'Не удалось сменить воронку');
      },
    });
  }
}
