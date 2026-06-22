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

export interface ProjectBase {
  id: string;
  lead_id?: string;
  lead_recipient_id?: string;
  client_user_id: string;
  specialist_user_id?: string;
  assigned_to_user_id?: string;
  pipeline_id: string;
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

export interface ProjectComment {
  id: string;
  project_id: string;
  author_id: string;
  author_name?: string;
  body: string;
  body_format: 'plain' | 'html' | 'tiptap_json';
  is_internal: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
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
