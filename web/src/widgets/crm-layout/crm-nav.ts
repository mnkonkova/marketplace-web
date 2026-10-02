import { CrmIconName } from '@shared/ui/crm-icon/crm-icon.component';

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
 *
 * 'moderation' и 'inbox' — очередь на вас: коралловый бейдж. Остальные —
 * приглушённый моноширинный счётчик: «сколько тут всего», а не «идите
 * разбирать». Имена совпадают с ключами nav_counts из /admin/summary —
 * сводить их таблицей соответствий значило бы завести второе место, где
 * можно ошибиться.
 */
export type CrmNavCounter =
  | 'moderation'
  | 'inbox'
  | 'projects_active'
  | 'team'
  | 'specialists'
  | 'clients'
  | 'checklists'
  | 'pipelines'
  | 'productions';

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
      {
        label: 'Проекты',
        link: '/admin/projects',
        icon: 'folder',
        also: ['/manager/projects'],
        counter: 'projects_active',
      },
      { label: 'Модерация', link: '/admin/moderation', icon: 'shield', counter: 'moderation' },
    ],
  },
  {
    title: 'Люди',
    items: [
      { label: 'Команда', link: '/admin/team', icon: 'team', counter: 'team' },
      { label: 'Специалисты', link: '/admin/specialists', icon: 'spec', counter: 'specialists' },
      { label: 'Клиенты', link: '/admin/clients', icon: 'client', counter: 'clients' },
    ],
  },
  {
    title: 'Креаторы',
    items: [
      { label: 'Прайс', link: '/admin/tariff', icon: 'price' },
      // Шаблоны договоров, актов и NDA — сразу под прайсом: и то, и другое —
      // условия, с которых начинается работа, и правятся они одинаково:
      // новой версией, не задним числом.
      { label: 'Документы', link: '/admin/documents', icon: 'doc' },
      { label: 'Чеклисты', link: '/admin/checklists', icon: 'check', counter: 'checklists' },
    ],
  },
  {
    title: 'Продакшн',
    items: [
      { label: 'Воронки', link: '/admin/pipelines', icon: 'flow', counter: 'pipelines' },
      { label: 'Продакшены', link: '/admin/productions', icon: 'studio', counter: 'productions' },
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

/**
 * Как называется корень пути в крошках.
 *
 * Одинаково у обеих ролей, и это решение владельца: «Кабинет менеджера»
 * и «Админка» читались как два разных продукта, хотя это один и тот же
 * экран с разным объёмом прав. Разницу между ролями говорит подпись под
 * именем, а не название всего кабинета.
 */
export function crmRootLabel(_role: CrmRole): string {
  return 'Админка';
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
