import {
  ProjectDisplayStatus,
  StageDisplayStatus,
  StepOwner,
  StepStatus,
} from '@entities/project/model/project.types';

// Лейблы и цвета — единственное место истины для UI бейджей по
// computed-статусам из бэка (см. internal/projects/display_status.go).

export const PROJECT_STATUS_LABEL: Record<ProjectDisplayStatus, string> = {
  not_started: 'Впереди',
  in_progress: 'В работе',
  waiting_action: 'Ждёт вас',
  completed: 'Готово',
  on_hold: 'На паузе',
  cancelled: 'Отменён',
};

export const PROJECT_STATUS_COLOR: Record<ProjectDisplayStatus, string> = {
  not_started: 'default',
  in_progress: 'blue',
  waiting_action: 'gold',
  completed: 'green',
  on_hold: 'orange',
  cancelled: 'red',
};

export const STAGE_STATUS_LABEL: Record<StageDisplayStatus, string> = {
  not_started: 'Впереди',
  active: 'В работе',
  completed: 'Готово',
};

export const STAGE_STATUS_COLOR: Record<StageDisplayStatus, string> = {
  not_started: 'default',
  active: 'blue',
  completed: 'green',
};

export const OWNER_LABEL: Record<StepOwner, string> = {
  client: 'вы',
  team: 'команда',
  system: 'система',
};

export interface StepBadge {
  label: string;
  color: string;
}

// getStepBadge — формирует бейдж для шага в зависимости от owner+status.
// waiting_client+client → «Ждёт вас» (gold); все остальные waiting_client →
// «В работе» (синий, мяч у команды).
export function getStepBadge(status: StepStatus, owner: StepOwner): StepBadge {
  switch (status) {
    case 'done':
      return { label: 'Готово', color: 'green' };
    // skipped появляется когда менеджер двигает проект через client-шаг
    // (action за клиентом, но менеджер уже завершил вручную) и при
    // авто-skip review-шага по таймауту. Для пользователя визуально это
    // тоже «Готово» — внутренне сохраняем skipped (для аналитики), но
    // показываем как done. Позже, когда появится отдельная семантика
    // (например, «закрыт без отзыва»), вернём отдельный лейбл.
    case 'skipped':
      return { label: 'Готово', color: 'green' };
    case 'in_progress':
      return { label: 'В работе', color: 'blue' };
    case 'waiting_client':
      return owner === 'client'
        ? { label: 'Ждёт вас', color: 'gold' }
        : { label: 'В работе', color: 'blue' };
    case 'rejected':
      return { label: 'Возврат', color: 'orange' };
    case 'pending':
    default:
      return { label: 'Впереди', color: 'default' };
  }
}
