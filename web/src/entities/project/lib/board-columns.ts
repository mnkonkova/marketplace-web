import { PipelineFull } from '@entities/pipeline/model/pipeline.types';

import { BoardColumn } from '../model/board.types';
import { ProjectManagerView } from '../model/project.types';

/**
 * Раскладка проектов по колонкам канбана.
 *
 * Колонка канбана — шаг воронки, а проект носит на себе шаг из своего
 * снимка: при старте проект копирует стадии и шаги воронки себе, с новыми
 * id. Поэтому `project.current_step_id` и `pipeline_step.id` — разные
 * записи, и сравнивать их напрямую нельзя: совпадений не будет вовсе.
 * Общее у копии и оригинала — позиция: (порядок стадии, порядок шага).
 * По ней же резолвит цель и сам бэк в MoveProjectToStep, когда канбан
 * присылает ему шаблонный id шага.
 *
 * Сравнение шло по одному имени шага на всю воронку, и это ломалось
 * буквально с первого клика в редакторе воронок: он добавляет шаги с
 * подписью «Новый шаг», две такие в разных стадиях — и проект попадал в
 * обе колонки сразу, включая ту, где ему делать нечего.
 *
 * Здесь имя сужено до стадии (её порядок проект знает точно — он приходит
 * в `current_stage_order`), а каждый проект попадает ровно в одну колонку:
 * раскладка идёт по проектам, а не фильтром внутри каждой колонки.
 */

/** Колонки воронки плоским списком: стадии по порядку, внутри — шаги. */
export function pipelineColumns(pipeline: PipelineFull): BoardColumn[] {
  const cols: BoardColumn[] = [];
  const stages = pipeline.stages.slice().sort((a, b) => a.sort_order - b.sort_order);
  for (const st of stages) {
    const steps = (st.steps ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
    for (const sp of steps) {
      cols.push({
        step_id: sp.id,
        step_name: sp.name,
        step_owner: sp.owner,
        stage_name: st.name,
        stage_order: st.sort_order,
        step_order: sp.sort_order,
        items: [],
      });
    }
  }
  return cols;
}

/**
 * Индекс колонки, в которой стоит проект, либо -1.
 *
 * Стадия отсекает однофамильцев из других стадий; при двух одинаковых
 * именах внутри одной стадии берётся первое — угадать между ними нечем,
 * но показать проект дважды хуже, чем показать не в той колонке из двух
 * соседних.
 */
export function columnIndexOf(cols: BoardColumn[], p: ProjectManagerView): number {
  const title = p.current_step_title;
  if (!title) return -1;
  const byStage = cols.findIndex(
    (c) => c.stage_order === p.current_stage_order && c.step_name === title,
  );
  if (byStage !== -1) return byStage;
  // Стадия не совпала ни с одной колонкой: воронку правили после старта
  // проекта, и его снимок разошёлся с ней. Тогда имя — единственное, что
  // осталось общего, и колонка хотя бы примерно та.
  return cols.findIndex((c) => c.step_name === title);
}

/** Шаг воронки, соответствующий текущему шагу проекта. '' — не нашёлся. */
export function currentStepId(cols: BoardColumn[], p: ProjectManagerView): string {
  const i = columnIndexOf(cols, p);
  return i === -1 ? '' : cols[i].step_id;
}

/** Доска одной воронки: колонки по шагам, проекты разложены по ним. */
export function buildBoardColumns(
  pipeline: PipelineFull,
  projects: ProjectManagerView[],
): BoardColumn[] {
  const cols = pipelineColumns(pipeline);
  for (const p of projects) {
    const i = columnIndexOf(cols, p);
    if (i !== -1) cols[i].items.push(p);
  }
  return cols;
}
