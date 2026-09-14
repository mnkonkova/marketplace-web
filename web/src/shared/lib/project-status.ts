import { StatusTone } from '@shared/ui/status-tag/status-tag.component';
import {
  ProjectDisplayStatus,
  ProjectKind,
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

// Смысл цвета, а не оттенок. nz-tag просил имя палитры ant ('gold',
// 'blue'…), и на соседних экранах одно и то же состояние приезжало то
// золотым, то оранжевым — палитру выбирали на глаз, по одному экрану.
// Здесь сказано, что цвет значит: ждём мы чего-то или нет.
export const PROJECT_STATUS_TONE: Record<ProjectDisplayStatus, StatusTone> = {
  not_started: 'neutral',
  in_progress: 'neutral',
  // Мяч на нашей стороне — единственное состояние, ради которого список
  // открывают.
  waiting_action: 'wait',
  on_hold: 'wait',
  completed: 'ok',
  cancelled: 'blocked',
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

// Вид проекта. Выкладки бывают только у creators_turnkey — до появления
// поля kind это определялось по наличию выкладок, то есть догадкой.
export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  creators_turnkey: 'Креаторы под ключ',
  production_turnkey: 'Продакшен под ключ',
  general: 'Общий проект',
};

// Прогресс у разных видов проекта измеряется разным, и полоска об этом
// молчит. У креаторов под ключ это доля закрытых выкладок, у продакшна —
// доля пройденных шагов воронки, у общего проекта прогресса нет вовсе:
// ни шагов, ни выкладок у него не бывает, и «0%» читалось бы как «ничего
// не сделано». Подпись рядом с полоской обязана называть меру — иначе
// два числа в соседних строках выглядят сравнимыми, не будучи таковыми.
export interface ProgressMeasure {
  // null — мерить нечем; полоску в этом случае не рисуем.
  percent: number | null;
  caption: string;
  hint: string;
}

export function projectProgressMeasure(
  kind: ProjectKind,
  progress: number,
  // Сколько всего шагов или выкладок. Ноль — мерить нечего, и это не то
  // же самое, что «ничего не сделано»: у проекта с непроставленными
  // датами бэк отдаёт progress = 100, и полоска рапортовала «всё
  // закрыто» там, где закрывать было нечего.
  total?: number | null,
): ProgressMeasure {
  const percent = Math.max(0, Math.min(100, Math.round(progress || 0)));
  const nothingToMeasure = total !== undefined && total !== null && total === 0;
  switch (kind) {
    case 'creators_turnkey':
      if (nothingToMeasure) {
        return {
          percent: null,
          caption: 'дат в плане нет',
          hint: 'Выкладки ещё не запланированы — закрывать нечего.',
        };
      }
      return {
        percent,
        caption: 'по выкладкам',
        hint: 'Доля выкладок, закрытых по плану периода.',
      };
    case 'production_turnkey':
      if (nothingToMeasure) {
        return {
          percent: null,
          caption: 'шагов нет',
          hint: 'У проекта не заведено ни одного шага воронки.',
        };
      }
      return {
        percent,
        caption: 'по шагам',
        hint: 'Доля пройденных шагов воронки.',
      };
    case 'general':
    default:
      return {
        percent: null,
        caption: 'не считается',
        hint: 'У общего проекта нет ни шагов, ни выкладок — считать прогресс не по чему.',
      };
  }
}

// Что писать в колонке «Стадия». Стадии бывают только у продакшна — у
// остальных прочерк выглядел как потерянные данные, хотя терять нечего.
export function projectStageLabel(kind: ProjectKind, currentStageName?: string): string {
  if (currentStageName) return currentStageName;
  switch (kind) {
    case 'creators_turnkey':
      return 'Без стадий — план выкладок';
    case 'general':
      return 'Без стадий — один срок';
    case 'production_turnkey':
    default:
      // Воронка есть, а текущей стадии нет — значит все пройдены.
      return 'Все стадии пройдены';
  }
}
