import { TestBed } from '@angular/core/testing';

import { PipelineFull, PipelineStageFull, PipelineStep } from '@entities/pipeline/model/pipeline.types';

import { StageMoveSheetComponent } from '@widgets/stage-move-sheet/stage-move-sheet.component';

function step(id: string, name: string, sort: number, owner: PipelineStep['owner'] = 'team'): PipelineStep {
  return {
    id,
    stage_id: 's',
    name,
    owner,
    duration_days: 1,
    visible_to_client: true,
    visible_to_specialist: true,
    weight: 1,
    sort_order: sort,
    is_review: false,
    created_at: '',
  };
}

function stage(id: string, name: string, sort: number, steps: PipelineStep[]): PipelineStageFull {
  return { id, pipeline_id: 'p', name, sort_order: sort, created_at: '', steps };
}

function makePipeline(stages: PipelineStageFull[]): PipelineFull {
  return {
    id: 'p',
    name: 'P',
    description: '',
    version: 1,
    is_active: true,
    is_default: false,
    revisions_included: 1,
    created_at: '',
    updated_at: '',
    stages,
  };
}

describe('StageMoveSheetComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StageMoveSheetComponent] });
  });

  describe('rows computation', () => {
    it('null pipeline → пустой массив', () => {
      const fixture = TestBed.createComponent(StageMoveSheetComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.rows()).toEqual([]);
    });

    it('flatten шагов с группировкой по stages, is_first_in_stage у первого шага каждой стадии', () => {
      const fixture = TestBed.createComponent(StageMoveSheetComponent);
      fixture.componentRef.setInput('pipeline', makePipeline([
        stage('s1', 'Stage 1', 0, [step('a', 'A', 0), step('b', 'B', 1)]),
        stage('s2', 'Stage 2', 1, [step('c', 'C', 0)]),
      ]));
      fixture.detectChanges();

      const rows = fixture.componentInstance.rows();
      expect(rows.length).toBe(3);
      expect(rows.map((r) => r.step_id)).toEqual(['a', 'b', 'c']);
      expect(rows.map((r) => r.is_first_in_stage)).toEqual([true, false, true]);
    });

    it('стадии сортируются по sort_order, шаги внутри стадии — тоже', () => {
      const fixture = TestBed.createComponent(StageMoveSheetComponent);
      // Stage B sort=0, Stage A sort=1 — порядок в output должен быть B, A.
      // Шаги внутри тоже: первый по sort_order, потом следующий.
      fixture.componentRef.setInput('pipeline', makePipeline([
        stage('sA', 'A', 1, [step('a2', 'A2', 1), step('a1', 'A1', 0)]),
        stage('sB', 'B', 0, [step('b1', 'B1', 0)]),
      ]));
      fixture.detectChanges();

      const rows = fixture.componentInstance.rows();
      expect(rows.map((r) => r.step_id)).toEqual(['b1', 'a1', 'a2']);
    });

    it('currentStepId помечает соответствующий ряд is_current=true', () => {
      const fixture = TestBed.createComponent(StageMoveSheetComponent);
      fixture.componentRef.setInput('pipeline', makePipeline([
        stage('s1', 'S1', 0, [step('a', 'A', 0), step('b', 'B', 1)]),
      ]));
      fixture.componentRef.setInput('currentStepId', 'b');
      fixture.detectChanges();

      const rows = fixture.componentInstance.rows();
      expect(rows.find((r) => r.step_id === 'a')?.is_current).toBe(false);
      expect(rows.find((r) => r.step_id === 'b')?.is_current).toBe(true);
    });
  });

  describe('outputs', () => {
    it('onTap текущего ряда → НЕ эмитит selectStep', () => {
      const fixture = TestBed.createComponent(StageMoveSheetComponent);
      const c = fixture.componentInstance;
      const spy = spyOn(c.selectStep, 'emit');
      c.onTap({
        stage_name: 'S', stage_order: 0, step_id: 'a', step_name: 'A',
        step_owner: 'team', is_first_in_stage: true, is_current: true,
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('onTap не-текущего ряда → эмитит selectStep(step_id)', () => {
      const fixture = TestBed.createComponent(StageMoveSheetComponent);
      const c = fixture.componentInstance;
      const spy = spyOn(c.selectStep, 'emit');
      c.onTap({
        stage_name: 'S', stage_order: 0, step_id: 'a', step_name: 'A',
        step_owner: 'team', is_first_in_stage: true, is_current: false,
      });
      expect(spy).toHaveBeenCalledWith('a');
    });

    it('onClose / onOpenProject / onChangeFunnel — эмитят соответствующие events', () => {
      const fixture = TestBed.createComponent(StageMoveSheetComponent);
      const c = fixture.componentInstance;
      const closeSpy = spyOn(c.close, 'emit');
      const openProjectSpy = spyOn(c.openProject, 'emit');
      const changeFunnelSpy = spyOn(c.changeFunnel, 'emit');

      c.onClose();
      c.onOpenProject();
      c.onChangeFunnel();

      expect(closeSpy).toHaveBeenCalled();
      expect(openProjectSpy).toHaveBeenCalled();
      expect(changeFunnelSpy).toHaveBeenCalled();
    });
  });

  describe('ownerIcon', () => {
    it('возвращает emoji для known owner types', () => {
      const c = TestBed.createComponent(StageMoveSheetComponent).componentInstance;
      expect(c.ownerIcon('client')).toBe('👤');
      expect(c.ownerIcon('team')).toBe('👥');
      expect(c.ownerIcon('system')).toBe('🤖');
      expect(c.ownerIcon('unknown')).toBe('•');
    });
  });
});
