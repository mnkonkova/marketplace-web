// Типы соответствуют DTO из marketplace-api/internal/projects/dto.go.
// Поля, отсутствующие в JSON (omitempty в Go), здесь optional.

export type ProjectStatus =
  | 'draft'
  | 'active'
  | 'on_hold'
  | 'done'
  | 'cancelled'
  | 'dispute';

export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting_client'
  | 'done'
  | 'rejected'
  | 'skipped';

export type ProjectDisplayStatus =
  | 'not_started'
  | 'in_progress'
  | 'waiting_action'
  | 'completed'
  | 'on_hold'
  | 'cancelled';

export type StageDisplayStatus = 'not_started' | 'active' | 'completed';

export type StepOwner = 'client' | 'team' | 'system';

// Вид проекта. До него фронт отличал проект с креаторами от воронки по
// наличию выкладок — то есть догадкой: пустой месяц у нового проекта
// выглядел так же, как проект, где выкладок не бывает вовсе.
export type ProjectKind = 'creators_turnkey' | 'production_turnkey' | 'general';

// Порядок админского списка. По умолчанию — самые давно обновлённые
// сверху: список открывают, чтобы увидеть, что не двигалось.
export type AdminProjectsSort = 'updated_asc' | 'updated_desc' | 'created_asc' | 'created_desc';

export interface ProjectBase {
  id: string;
  lead_id?: string;
  lead_recipient_id?: string;
  client_user_id: string;
  specialist_user_id?: string;
  assigned_to_user_id?: string;
  // Воронки нет у общего проекта, и поле в ответе тогда отсутствует:
  // нулевой uuid раньше врал, что она есть. Логика «воронка есть» должна
  // смотреть на kind, а не на наличие id.
  pipeline_id?: string;
  kind: ProjectKind;
  // Проект заведён для проверки стенда. Админский список такие прячет,
  // пока не попросят показать.
  is_test: boolean;
  title: string;
  source: string;
  status: ProjectStatus;
  revisions_included: number;
  revisions_used: number;
  budget?: number;
  notes?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectStepView {
  id: string;
  project_id: string;
  stage_id: string;
  name: string;
  owner: StepOwner;
  status: StepStatus;
  duration_days: number;
  visible_to_client: boolean;
  visible_to_specialist: boolean;
  weight: number;
  sort_order: number;
  is_review: boolean;
  eta_date?: string;
  review_deadline?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  is_current?: boolean;
}

export interface ProjectStageView {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  started_at?: string;
  completed_at?: string;
  display_status: StageDisplayStatus;
  steps_total: number;
  steps_done: number;
  steps: ProjectStepView[];
}

export interface ProjectClientView extends ProjectBase {
  display_status: ProjectDisplayStatus;
  progress: number;
  current_step_id?: string;
  current_step_title?: string;
  current_step_owner?: StepOwner;
  current_step_status?: StepStatus;
  revisions_total: number;
  specialist_display_name?: string;
  // Основная категория исполнителя (e.g., «Видеооператор», «Дизайнер»).
  // Используется как опознавательный знак карточки когда у клиента
  // несколько проектов.
  specialist_primary_category?: string;
  stages: ProjectStageView[];
}

export interface ProjectManagerView extends ProjectBase {
  client_display_name?: string;
  client?: PartyContact;
  specialist?: PartyContact;
  // Имя ответственного менеджера. Пусто = проект никем не взят.
  manager_display_name?: string;
  display_status: ProjectDisplayStatus;
  progress: number;
  current_stage_id?: string;
  current_stage_name?: string;
  current_stage_order: number;
  current_step_id?: string;
  current_step_title?: string;
  current_step_owner?: StepOwner;
  current_step_status?: StepStatus;
}

export interface ProjectFullView extends ProjectBase {
  client?: PartyContact;
  specialist?: PartyContact;
  proposed_specialist?: PartyContact;
  display_status: ProjectDisplayStatus;
  progress: number;
  current_step_id?: string;
  current_step_title?: string;
  current_step_owner?: StepOwner;
  current_step_status?: StepStatus;
  stages: ProjectStageView[];
}

export interface PartyContact {
  display_name?: string;
  email?: string;
  phone?: string;
  telegram?: string;
}

// Ветка переписки. Их три, и делит их право читать: клиентская (клиент ↔
// менеджер), креаторская (у каждого креатора своя) и внутренняя, которую
// видит только персонал.
export type CommentThread = 'client' | 'creator' | 'internal';

export type CommentBodyFormat = 'plain' | 'html' | 'tiptap_json';

export interface ProjectComment {
  id: string;
  project_id: string;
  author_id: string;
  author_name?: string;
  // Тело в формате body_format. Для html здесь уже очищенная сервером
  // разметка: чистка происходит на записи, читателю отдаётся готовое.
  body: string;
  // То же без тегов. Для превью и заголовков брать надо его.
  body_text?: string;
  body_format: CommentBodyFormat;
  // Ветка. Старые записи приходят без него — тогда её определяет
  // is_internal, см. threadOf().
  thread?: CommentThread;
  // Заполнен только у creator: чья это ветка.
  thread_user_id?: string;
  // Кого реально упомянули. Постороннего сервер молча выбрасывает, так
  // что здесь — те, до кого уведомление дошло.
  mentions?: string[];
  is_internal: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

// Участник ветки — он же множество, по которому сервер проверяет
// упоминания на записи.
export interface CommentParticipant {
  user_id: string;
  display_name: string;
  role: 'client' | 'creator' | 'specialist' | 'manager' | 'admin';
}

// Тело запроса на отправку. thread и creator_id заполняет только
// менеджер: у клиента и креатора ветка одна и определяется ручкой.
export interface CommentInput {
  body: string;
  body_format?: CommentBodyFormat;
  thread?: CommentThread;
  creator_id?: string;
}

export interface ProjectEvent {
  id: number;
  project_id: string;
  step_id?: string;
  actor_user_id?: string;
  actor_display_name?: string;
  actor_type: 'human' | 'system';
  event_kind: 'step_transition' | 'stage_advance' | 'comment' | 'assigned' | 'created';
  from_status?: StepStatus;
  to_status?: StepStatus;
  comment?: string;
  payload?: unknown;
  created_at: string;
}
