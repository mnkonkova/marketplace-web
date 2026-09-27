/**
 * Как называются действия журнала по-русски.
 *
 * Список закрытый и совпадает с константами `internal/audit`: журнал
 * читают, чтобы понять, кто что сделал, а `user.revoke_manager` этого не
 * говорит. Незнакомый код показываем как есть — новое действие на бэке не
 * должно превращать строку журнала в пустоту.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'user.promote_manager': 'выдал роль менеджера',
  'user.revoke_manager': 'снял роль менеджера',
  'user.approve_manager': 'открыл доступ в CRM',
  'user.deactivate': 'заблокировал вход',
  'user.activate': 'разблокировал вход',
  'user.verify_email': 'подтвердил почту',
  'user.mark_test': 'изменил пометку «тест»',
  'user.login_link': 'выдал ссылку для входа',
  'moderation.approve': 'одобрил профиль',
  'moderation.reject': 'отклонил профиль',
  'terms.publish': 'выпустил версию прайса',
  'checklist.publish': 'выпустил версию чеклиста',
  'project.cancel': 'отменил проект',
  'project.restore': 'вернул проект',
  'project.assign_manager': 'сменил ответственного',
  'project.mark_test': 'изменил пометку «тест»',
  'project.transfer_batch': 'передал проекты',
  // Переоткрытие периода — правка уже выставленного счёта, и в журнал
  // она попадает именно поэтому. Кодом `project.period_unlock` строка
  // читалась как техническая запись, то есть как «не про деньги».
  'project.period_unlock': 'переоткрыл период',
};

/** Над чем действие совершили. Ключи — object_type из журнала. */
export const AUDIT_OBJECT_LABEL: Record<string, string> = {
  user: 'человек',
  project: 'проект',
  terms_version: 'версия прайса',
  checklist_template: 'чеклист',
};

/** Варианты фильтра «что делали» — те же коды, но сгруппированы по смыслу. */
export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Любое действие' },
  ...Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({
    value,
    // В фильтре действие называется само по себе, без подлежащего:
    // «снял роль менеджера» в выпадающем списке читается как обрывок.
    label: label.charAt(0).toUpperCase() + label.slice(1),
  })),
];

export const AUDIT_OBJECT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Любой объект' },
  { value: 'user', label: 'Люди' },
  { value: 'project', label: 'Проекты' },
  { value: 'terms_version', label: 'Прайс' },
  { value: 'checklist_template', label: 'Чеклисты' },
];
