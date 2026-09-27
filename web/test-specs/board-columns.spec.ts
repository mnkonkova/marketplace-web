import {
  buildBoardColumns,
  columnIndexOf,
  currentStepId,
} from '@entities/project/lib/board-columns';
import { PipelineFull } from '@entities/pipeline/model/pipeline.types';
import { ProjectManagerView } from '@entities/project/model/project.types';

/**
 * Раскладка канбана.
 *
 * Проекты сваливались в чужие колонки: сравнение шло по одному имени шага
 * на всю воронку, а редактор воронок добавляет шаги с подписью «Новый
 * шаг». Две такие в разных стадиях — и проект попадал в обе сразу.
 *
 * По идентификатору шага это не чинится: проект копирует шаги воронки
 * себе при старте, и у копии свой id. Общее у копии и оригинала —
 * позиция, по ней же резолвит цель и бэк в MoveProjectToStep.
 */

function step(id: string, name: string, order: number) {
  return {
    id,
    stage_id: 'st',
    name,
    owner: 'team' as const,
    duration_days: 1,
    visible_to_client: true,
    visible_to_specialist: true,
    weight: 1,
    sort_order: order,
    is_review: false,
    created_at: '2026-01-01T00:00:00Z',
  };
}

/** Воронка, какую собирает редактор: два «Новых шага» в разных стадиях. */
function pipeline(): PipelineFull {
  return {
    id: 'pl-1',
    name: 'Продакшн',
    description: '',
    version: 1,
    is_active: true,
    is_default: true,
    revisions_included: 2,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    stages: [
      {
        id: 'stage-b',
        pipeline_id: 'pl-1',
        name: 'Монтаж',
        sort_order: 1,
        created_at: '2026-01-01T00:00:00Z',
        steps: [step('sp-3', 'Новый шаг', 0), step('sp-4', 'Сдача', 1)],
      },
      {
        id: 'stage-a',
        pipeline_id: 'pl-1',
        name: 'Бриф',
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        steps: [step('sp-2', 'Новый шаг', 1), step('sp-1', 'Бриф', 0)],
      },
    ],
  };
}

function project(id: string, stepTitle: string, stageOrder: number): ProjectManagerView {
  return {
    id,
    client_user_id: 'c',
    kind: 'production_turnkey',
    is_test: false,
    title: id,
    source: 'crm',
    status: 'active',
    revisions_included: 2,
    revisions_used: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    display_status: 'in_progress',
    progress: 10,
    current_stage_order: stageOrder,
    // Шаг проекта — своя запись со своим id: с id шага воронки он не
    // совпадает никогда.
    current_step_id: `project-step-${id}`,
    current_step_title: stepTitle,
  };
}

describe('колонки канбана', () => {
  it('колонки идут по порядку стадий, внутри — по порядку шагов', () => {
    const cols = buildBoardColumns(pipeline(), []);
    expect(cols.map((c) => c.step_id)).toEqual(['sp-1', 'sp-2', 'sp-3', 'sp-4']);
    expect(cols.map((c) => c.stage_name)).toEqual(['Бриф', 'Бриф', 'Монтаж', 'Монтаж']);
  });

  it('одинаковые имена шагов разводятся по стадиям', () => {
    const cols = buildBoardColumns(pipeline(), [
      project('p-brief', 'Новый шаг', 0),
      project('p-edit', 'Новый шаг', 1),
    ]);
    const byStep = Object.fromEntries(cols.map((c) => [c.step_id, c.items.map((i) => i.id)]));
    expect(byStep['sp-2']).toEqual(['p-brief']);
    expect(byStep['sp-3']).toEqual(['p-edit']);
  });

  it('проект стоит ровно в одной колонке, а не во всех однофамильцах', () => {
    const cols = buildBoardColumns(pipeline(), [project('p-brief', 'Новый шаг', 0)]);
    const total = cols.reduce((n, c) => n + c.items.length, 0);
    expect(total).toBe(1);
  });

  it('шаг проекта и шаг воронки — разные записи, по id их не сводят', () => {
    const cols = buildBoardColumns(pipeline(), [project('p-brief', 'Новый шаг', 0)]);
    const p = cols.find((c) => c.step_id === 'sp-2')!.items[0];
    expect(p.current_step_id).not.toBe('sp-2');
    // Но шаг воронки, соответствующий проектному, находится однозначно —
    // именно его id уезжает в MoveProjectToStep.
    expect(currentStepId(cols, p)).toBe('sp-2');
  });

  it('воронку правили после старта проекта — колонку ищем хотя бы по имени', () => {
    const cols = buildBoardColumns(pipeline(), []);
    // Стадии с таким порядком в воронке уже нет; имя шага — единственное,
    // что осталось общего.
    expect(columnIndexOf(cols, project('p', 'Сдача', 7))).toBe(3);
  });

  it('шага нет в воронке вовсе — проект в доску не попадает', () => {
    const cols = buildBoardColumns(pipeline(), [project('p', 'Шаг, которого нет', 0)]);
    expect(cols.every((c) => c.items.length === 0)).toBeTrue();
    expect(currentStepId(cols, project('p', 'Шаг, которого нет', 0))).toBe('');
  });

  it('текущего шага нет (все пройдены) — колонки не выбирается', () => {
    const cols = buildBoardColumns(pipeline(), []);
    const done = project('p', '', 0);
    done.current_step_title = undefined;
    expect(columnIndexOf(cols, done)).toBe(-1);
  });
});
