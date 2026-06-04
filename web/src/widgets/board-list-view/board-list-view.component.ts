import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { BoardColumn, BoardForPipeline } from '@entities/project/model/board.types';
import { ProjectManagerView, StepOwner } from '@entities/project/model/project.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';

/** Группа = одна стадия воронки. items — проекты на любом шаге этой стадии. */
interface StageGroup {
  stage_name: string;
  stage_order: number;
  step_count: number; // сколько шагов в этой стадии — справочно для заголовка
  items: { project: ProjectManagerView; step_name: string; step_owner: StepOwner }[];
}

/**
 * Тач-замена канбана: вертикальный accordion по стадиям воронки.
 *
 * UX: тап по карточке → bottom-sheet с шагами для переноса + кнопкой
 * «Открыть проект». Раньше пробовали long-press / отдельную ⋯-кнопку —
 * на тачах надёжно отделить эти жесты не получается (палец гуляет,
 * pointerup re-targets). Один действие = один путь.
 */
@Component({
  selector: 'app-board-list-view',
  standalone: true,
  imports: [CommonModule, NzTagModule],
  templateUrl: './board-list-view.component.html',
  styleUrl: './board-list-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardListViewComponent {
  public readonly board = input.required<BoardForPipeline>();

  /** Тап по карточке — родитель показывает sheet с шагами и кнопкой
   *  «Открыть проект». Раздельных событий «открыть» и «переместить» нет. */
  public readonly cardTap = output<ProjectManagerView>();

  /** Свёрнутые стадии (по stage_name). По умолчанию все развёрнуты. */
  public readonly collapsed = signal<Set<string>>(new Set());

  public readonly groups = computed<StageGroup[]>(() => {
    const cols = this.board().columns;
    const byStage = new Map<string, StageGroup>();
    // Сохраняем порядок стадий по stage_order (первое появление).
    for (const c of cols) {
      let g = byStage.get(c.stage_name);
      if (!g) {
        g = {
          stage_name: c.stage_name,
          stage_order: c.stage_order,
          step_count: 0,
          items: [],
        };
        byStage.set(c.stage_name, g);
      }
      g.step_count++;
      for (const project of c.items) {
        g.items.push({ project, step_name: c.step_name, step_owner: c.step_owner });
      }
    }
    return [...byStage.values()].sort((a, b) => a.stage_order - b.stage_order);
  });

  public onCardTap(p: ProjectManagerView): void {
    this.cardTap.emit(p);
  }

  public toggleStage(name: string): void {
    const next = new Set(this.collapsed());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.collapsed.set(next);
  }

  public isCollapsed(name: string): boolean {
    return this.collapsed().has(name);
  }

  public statusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public statusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public ownerIcon(o: StepOwner): string {
    switch (o) {
      case 'client': return '👤';
      case 'team':   return '👥';
      case 'system': return '🤖';
    }
  }

}
