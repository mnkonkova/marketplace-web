/**
 * Типы оболочки админки: сводка, журнал, команда, карточка человека и
 * ⌘K-поиск. Соответствуют DTO из marketplace-api/internal/admin.
 */

/** Строка внутри блока «Требует внимания»: что именно ждёт. */
export interface AttentionItem {
  id: string;
  title: string;
  /** Готовая подпись от сервера: «12 дн. без движения». Своей не сочиняем. */
  note?: string;
}

export interface AttentionBlock {
  count: number;
  /** Первые несколько строк. Никогда не null — пустой список значит «чисто». */
  items: AttentionItem[];
}

export interface ModerationAttentionBlock extends AttentionBlock {
  /** Сколько заявок ждёт дольше суток — ради них блок и заметен. */
  over_day: number;
}

/** Восемь поводов зайти в админку сегодня. Ключи фиксированные. */
export interface Attention {
  moderation: ModerationAttentionBlock;
  projects_unassigned: AttentionBlock;
  projects_stale: AttentionBlock;
  managers_unapproved: AttentionBlock;
  specialist_not_confirmed: AttentionBlock;
  publications_overdue: AttentionBlock;
  work_without_prepayment: AttentionBlock;
  revisions_exceeded: AttentionBlock;
}

export type AttentionKey = keyof Attention;

/** Счётчики разделов сайдбара — тем же запросом, что и сводка. */
export interface NavCounts {
  projects_active: number;
  moderation_pending: number;
  team: number;
  specialists: number;
  clients: number;
  checklists: number;
  pipelines: number;
  productions: number;
}

/** Человек в команде: нагрузка и последний вход. */
export interface TeamMember {
  user_id: string;
  email?: string;
  display_name?: string;
  is_admin: boolean;
  is_manager: boolean;
  is_approved: boolean;
  is_active: boolean;
  active_projects: number;
  overdue_projects: number;
  /** Пусто — не входил ни разу. Не то же самое, что «давно не заходил». */
  last_login_at?: string;
  created_at: string;
}

export interface AdminSummary {
  attention: Attention;
  /** nav_counts доехал не во всех сборках стенда — читаем как необязательный. */
  nav_counts?: NavCounts;
  /** Ключи всегда все, включая нулевые: пропавший статус читался бы как ошибка. */
  projects_by_kind: Record<string, number>;
  projects_by_status: Record<string, number>;
  managers: TeamMember[];
  generated_at: string;
}

// ─── Журнал ──────────────────────────────────────────────────────

/** Запись журнала. Список действий закрытый — см. internal/audit. */
export interface AuditEntry {
  id: number;
  /** Пусто — действие не человека: фоновая задача или вызов мимо HTTP. */
  actor_user_id?: string;
  actor_email?: string;
  actor_display_name?: string;
  action: string;
  object_type: 'user' | 'project' | 'terms_version' | 'checklist_template' | string;
  object_id?: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface AuditResult {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditParams {
  actor?: string;
  action?: string;
  object_type?: string;
  object_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ─── Карточка человека ───────────────────────────────────────────

export interface UserProjectRef {
  id: string;
  title: string;
  /** Кем он в этом проекте. Один человек бывает и заказчиком, и исполнителем. */
  role: 'client' | 'specialist' | 'manager' | string;
  kind: string;
  status: string;
  is_test: boolean;
  updated_at: string;
}

export interface ModerationInfo {
  status: 'pending_review' | 'approved' | 'rejected' | string;
  reason?: string;
  reviewed_at?: string;
  reviewed_by?: string;
  is_published: boolean;
}

export interface UserCard {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: 'client' | 'specialist' | 'both';
  is_admin: boolean;
  is_manager: boolean;
  is_approved: boolean;
  is_active: boolean;
  email_verified: boolean;
  email_verified_at?: string;
  created_at: string;
  last_login_at?: string;
  is_test?: boolean;
  moderation_status?: string;
  is_published?: boolean;
  /** null у тех, у кого профиля специалиста нет: у клиента модерации не бывает. */
  moderation?: ModerationInfo;
  projects: UserProjectRef[];
  audit: AuditEntry[];
}

// ─── ⌘K-поиск ────────────────────────────────────────────────────

export interface SearchProjectHit {
  id: string;
  title: string;
  client_name?: string;
  kind: string;
  status: string;
  is_test: boolean;
  updated_at: string;
}

export interface SearchUserHit {
  id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: string;
  is_admin: boolean;
  is_manager: boolean;
  is_active: boolean;
}

export interface AdminSearchResult {
  projects: SearchProjectHit[];
  users: SearchUserHit[];
}

// ─── Снятие роли и передача дел ──────────────────────────────────

/** Проект, который держит менеджера: приходит в 409 на снятие роли. */
export interface ActiveProjectRef {
  id: string;
  title: string;
  status: string;
  updated_at: string;
}

/** Тело 409 от `/admin/managers/{id}/revoke`. */
export interface ActiveProjectsConflict {
  error: string;
  message: string;
  projects: ActiveProjectRef[];
}

export interface TransferResult {
  transferred: number;
  project_ids: string[];
}

/** Одноразовая ссылка входа сотруднику. Отправки на почту нет. */
export interface LoginLinkResult {
  token: string;
  url: string;
  expires_at: string;
}
