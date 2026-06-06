import { TestBed } from '@angular/core/testing';

import { BoardColumn, BoardForPipeline } from '@entities/project/model/board.types';
import { ProjectManagerView } from '@entities/project/model/project.types';

import { BoardListViewComponent } from './board-list-view.component';

function col(
  stage_name: string,
  stage_order: number,
  step_name: string,
  step_order: number,
  items: ProjectManagerView[] = [],
): BoardColumn {
  return {
    step_id: `${stage_name}-${step_name}`,
    step_name,
    step_owner: 'team',
    stage_name,
    stage_order,
    step_order,
    items,
  };
}

function project(id: string, title: string): ProjectManagerView {
  return {
    id,
    title,
    pipeline_id: 'p1',
    source: 'manual',
    status: 'active',
    display_status: 'in_progress',
    revisions_included: 1,
    revisions_used: 0,
    progress: 50,
    current_stage_order: 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    client_user_id: 'c1',
  } as ProjectManagerView;
}

function makeBoard(columns: BoardColumn[]): BoardForPipeline {
  return { pipeline: { id: 'p1' }, columns };
}

describe('BoardListViewComponent', () => {
  let component: BoardListViewComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BoardListViewComponent] });
    const fixture = TestBed.createComponent(BoardListViewComponent);
    component = fixture.componentInstance;
  });

  it('toggleStage: меняет collapsed-состояние', () => {
    expect(component.isCollapsed('Stage A')).toBe(false);
    component.toggleStage('Stage A');
    expect(component.isCollapsed('Stage A')).toBe(true);
    component.toggleStage('Stage A');
    expect(component.isCollapsed('Stage A')).toBe(false);
  });

  it('onCardTap: эмитит cardTap output с проектом', () => {
    const spy = spyOn(component.cardTap, 'emit');
    const p = project('p1', 'Test');
    component.onCardTap(p);
    expect(spy).toHaveBeenCalledWith(p);
  });

  it('ownerIcon: возвращает emoji для каждого owner', () => {
    expect(component.ownerIcon('client')).toBe('👤');
    expect(component.ownerIcon('team')).toBe('👥');
    expect(component.ownerIcon('system')).toBe('🤖');
  });

  it('statusLabel/statusColor: проксируют project-status маппинги', () => {
    expect(component.statusLabel('completed')).toBeTruthy();
    expect(component.statusColor('cancelled')).toBe('red');
  });
});

// === groups computation — отдельным fixture-тестом, чтобы input.required успел проставиться ===

describe('BoardListViewComponent.groups', () => {
  it('сортирует группы по stage_order, проекты внутри stage идут по step_order', () => {
    TestBed.configureTestingModule({ imports: [BoardListViewComponent] });
    const fixture = TestBed.createComponent(BoardListViewComponent);
    const board = makeBoard([
      // stage B сначала во входных данных, но stage_order=1 → должен быть второй
      col('Stage B', 1, 'B1', 0, [project('pb1', 'PB1')]),
      col('Stage A', 0, 'A2', 1, [project('pa2', 'PA2')]),
      col('Stage A', 0, 'A1', 0, [project('pa1', 'PA1')]),
    ]);
    fixture.componentRef.setInput('board', board);
    fixture.detectChanges();

    const groups = fixture.componentInstance.groups();
    expect(groups.map((g) => g.stage_name)).toEqual(['Stage A', 'Stage B']);
    expect(groups[0].items.map((i) => i.project.id)).toEqual(['pa2', 'pa1']);
    expect(groups[0].step_count).toBe(2);
    expect(groups[1].step_count).toBe(1);
  });

  it('пустые группы (без проектов) тоже в выводе — заголовок виден', () => {
    const fixture = TestBed.createComponent(BoardListViewComponent);
    fixture.componentRef.setInput('board', makeBoard([col('Empty', 0, 's', 0, [])]));
    fixture.detectChanges();

    const groups = fixture.componentInstance.groups();
    expect(groups.length).toBe(1);
    expect(groups[0].items.length).toBe(0);
  });
});
