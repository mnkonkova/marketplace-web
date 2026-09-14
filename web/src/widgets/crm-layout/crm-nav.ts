import { CrmIconName } from './crm-icon.component';

/**
 * Состав сайдбара CRM.
 *
 * Вынесено из компонента отдельным модулем не ради красоты слоёв, а ради
 * проверяемости: «у менеджера нет админских разделов» — это утверждение
 * про данные, и проверять его удобнее прямым вызовом, чем поднимая
 * оболочку с роутером и живой сессией.
 */

/** Роль, для которой собирается меню. Остальные в CRM не заходят. */
export type CrmRole = 'admin' | 'manager';

/**
 * Что показать справа в пункте.
 *   'moderation' и 'inbox' — очередь на вас: коралловый бейдж;
 *   остальное — приглушённый моноширинный счётчик.
 */
export type CrmNavCounter = 'moderation' | 'inbox';

export interface CrmNavItem {
  label: string;
  link: string;
  icon: CrmIconName;
  /**
   * Активен только на точном совпадении. Нужен корневым адресам разделов
   * (`/admin`, `/manager`): без этого «Сводка» горела бы на всех
   * страницах админки сразу.
   */
  exact?: boolean;
  /** Дополнительные префиксы URL, на которых пункт тоже считается активным. */
  also?: string[];
  counter?: CrmNavCounter;
}

export interface CrmNavGroup {
  title: string;
  items: CrmNavItem[];
}

const ADMIN_GROUPS: CrmNavGroup[] = [
  {
    title: 'Работа',
    items: [
      { label: 'Сводка', link: '/admin', icon: 'home', exact: true },
      // Карточка проекта живёт по менеджерскому адресу, но для админа это
      // тот же раздел «Проекты» — иначе, открыв проект, он теряет, где
      // находится.
      { label: 'Проекты', link: '/admin/projects', icon: 'folder', also: ['/manager/projects'] },
      { label: 'Модерация', link: '/admin/moderation', icon: 'shield', counter: 'moderation' },
    ],
  },
  {
    title: 'Люди',
    items: [
      { label: 'Команда', link: '/admin/team', icon: 'team' },
      { label: 'Специалисты', link: '/admin/specialists', icon: 'spec' },
      { label: 'Клиенты', link: '/admin/clients', icon: 'client' },
    ],
  },
  {
    title: 'Креаторы',
    items: [
      { label: 'Прайс', link: '/admin/tariff', icon: 'price' },
      { label: 'Чеклисты', link: '/admin/checklists', icon: 'check' },
    ],
  },
  {
    title: 'Продакшн',
    items: [
      { label: 'Воронки', link: '/admin/pipelines', icon: 'flow' },
      { label: 'Продакшены', link: '/admin/productions', icon: 'studio' },
    ],
  },
];

const MANAGER_GROUPS: CrmNavGroup[] = [
  {
    title: 'Работа',
    items: [
      { label: 'Входящие', link: '/manager', icon: 'inbox', exact: true, counter: 'inbox' },
      { label: 'Мои проекты', link: '/manager/projects', icon: 'folder' },
    ],
  },
];

/** Разделы CRM для роли. Массивы общие и неизменяемые — их только читают. */
export function crmNavGroups(role: CrmRole): CrmNavGroup[] {
  return role === 'admin' ? ADMIN_GROUPS : MANAGER_GROUPS;
}

/** Как называется корень пути в крошках. */
export function crmRootLabel(role: CrmRole): string {
  return role === 'admin' ? 'Админка' : 'Кабинет менеджера';
}

/**
 * Горит ли пункт на этом адресе.
 *
 * URL приходит с query: вид списка (`?view=board`) — это тот же раздел
 * «Проекты», и подсветку он менять не должен, поэтому хвост отрезаем.
 */
export function crmNavItemActive(item: CrmNavItem, url: string): boolean {
  const path = url.split('?')[0].split('#')[0];
  if (item.exact) return path === item.link;
  return [item.link, ...(item.also ?? [])].some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Где мы находимся — группа и пункт. Из этого собираются крошки
 * «Админка / Работа / Проекты»: писать их руками на каждой странице
 * значит держать два источника правды об одном и том же дереве.
 */
export function crmNavLocate(
  role: CrmRole,
  url: string,
): { group: CrmNavGroup; item: CrmNavItem } | null {
  for (const group of crmNavGroups(role)) {
    for (const item of group.items) {
      if (crmNavItemActive(item, url)) return { group, item };
    }
  }
  return null;
}
