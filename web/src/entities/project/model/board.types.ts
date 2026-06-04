import { ProjectManagerView, StepOwner } from './project.types';

/**
 * Колонка канбана = ШАГ (step) воронки. Плоский список колонок упорядочен
 * stage.sort_order → step.sort_order. На каждой колонке висит свой items[]
 * по фильтру `p.current_step_title === step.name`.
 */
export interface BoardColumn {
  step_id: string;
  step_name: string;
  step_owner: StepOwner;
  stage_name: string;
  stage_order: number;
  step_order: number;
  items: ProjectManagerView[];
}

/**
 * Канбан одного pipeline'а. На фронте — один на pipeline; в кабинете
 * менеджера/админа их может быть несколько (выбор через dropdown).
 */
export interface BoardForPipeline<P = unknown> {
  pipeline: P;
  columns: BoardColumn[];
}
