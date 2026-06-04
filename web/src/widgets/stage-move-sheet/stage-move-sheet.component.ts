import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';

import { PipelineFull } from '@entities/pipeline/model/pipeline.types';

/** Плоский ряд для рендера в sheet: одна строка = один step. */
interface StageRow {
  stage_name: string;
  stage_order: number;
  step_id: string;
  step_name: string;
  step_owner: string;
  is_first_in_stage: boolean;
  is_current: boolean;
}

/**
 * Bottom-sheet «Переместить в…» — список шагов воронки сгруппирован по
 * стадиям. Текущий шаг — отдельным стилем, тап игнорируется. Backend
 * сам отрулит invalid-переходы (вернёт 409), parent покажет toast.
 */
@Component({
  selector: 'app-stage-move-sheet',
  standalone: true,
  imports: [CommonModule, NzDrawerModule],
  templateUrl: './stage-move-sheet.component.html',
  styleUrl: './stage-move-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageMoveSheetComponent {
  public readonly visible = input<boolean>(false);
  public readonly pipeline = input<PipelineFull | null>(null);
  public readonly currentStepId = input<string>('');
  public readonly projectTitle = input<string>('');
  /** Показывать кнопку «Сменить воронку» (только в admin board). */
  public readonly enableChangeFunnel = input<boolean>(false);

  public readonly close = output<void>();
  public readonly selectStep = output<string>();
  /** Открыть проект — отдельное действие из того же sheet. */
  public readonly openProject = output<void>();
  /** Открыть диалог смены воронки. */
  public readonly changeFunnel = output<void>();

  public readonly rows = computed<StageRow[]>(() => {
    const pl = this.pipeline();
    if (!pl) return [];
    const out: StageRow[] = [];
    const currentId = this.currentStepId();
    const stages = pl.stages.slice().sort((a, b) => a.sort_order - b.sort_order);
    for (const st of stages) {
      const steps = (st.steps ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
      steps.forEach((sp, i) => {
        out.push({
          stage_name: st.name,
          stage_order: st.sort_order,
          step_id: sp.id,
          step_name: sp.name,
          step_owner: sp.owner,
          is_first_in_stage: i === 0,
          is_current: sp.id === currentId,
        });
      });
    }
    return out;
  });

  public ownerIcon(o: string): string {
    switch (o) {
      case 'client': return '👤';
      case 'team':   return '👥';
      case 'system': return '🤖';
      default:       return '•';
    }
  }

  public onTap(row: StageRow): void {
    if (row.is_current) return;
    this.selectStep.emit(row.step_id);
  }

  public onClose(): void {
    this.close.emit();
  }

  public onOpenProject(): void {
    this.openProject.emit();
  }

  public onChangeFunnel(): void {
    this.changeFunnel.emit();
  }
}
