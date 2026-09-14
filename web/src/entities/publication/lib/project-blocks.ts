import { ProjectKind } from '@entities/project/model/project.types';

// Какие блоки проекта показывать. Карта продиктована не макетом, а тем,
// что реально отдаёт API: у роли либо есть ручка, либо блока нет. Раньше
// это разъезжалось по трём страницам, и «чеклист» появлялся там, где
// GET-ручки для него не существует.
export type ProjectViewerRole = 'client' | 'creator' | 'manager';

export interface ProjectBlocks {
  // Лента вышедших роликов (GET /me/projects/{id}/videos).
  feed: boolean;
  // Календарь месяца (GET /me/projects/{id}/calendar).
  calendar: boolean;
  // Цифры отчёта. У клиента отключаются настройкой проекта: бэк отвечает
  // 404 и на отчёт, и на цифры в ленте.
  stats: boolean;
  // Настройки уведомлений в боте (GET/PUT .../notifications).
  notifications: boolean;
  // Чеклист выкладки. У креатора — снимок проекта, у менеджера с ним же
  // библиотека шаблонов и подключение новой версии.
  checklist: boolean;
  // Список выкладок с действиями (сдать ссылки / закрыть / напомнить).
  publications: boolean;
  // Внутренние комментарии — их не видит ни клиент, ни креатор.
  internalComments: boolean;
  // Состав проекта со ссылками на аккаунты (GET .../creators).
  roster: boolean;
  // Четыре тумблера автопинга (GET/PUT .../autoping).
  autoping: boolean;
  // Массовая простановка дат.
  batchScheduling: boolean;
  csvExport: boolean;
}

export interface ProjectBlocksInput {
  // Вид проекта. Выкладки бывают только у creators_turnkey; у остальных
  // блоки лишние. Раньше это определялось по данным — пустая лента при
  // пустом календаре считалась проектом по воронке, — и новый проект с
  // ещё не проставленными датами выглядел так же, как проект, где
  // выкладок не бывает вовсе.
  kind: ProjectKind;
  // Показ статистики включён в настройках проекта.
  statsAllowed: boolean;
}

export function projectBlocks(
  role: ProjectViewerRole,
  { kind, statsAllowed }: ProjectBlocksInput,
): ProjectBlocks {
  const off: ProjectBlocks = {
    feed: false,
    calendar: false,
    stats: false,
    notifications: false,
    checklist: false,
    publications: false,
    internalComments: false,
    roster: false,
    autoping: false,
    batchScheduling: false,
    csvExport: false,
  };
  if (kind !== 'creators_turnkey') return off;

  switch (role) {
    case 'client':
      return {
        ...off,
        feed: true,
        calendar: true,
        stats: statsAllowed,
        notifications: true,
        // Выгрузка живёт по тому же правилу, что и сам отчёт: при
        // выключенном показе статистики бэк отвечает 404 и на неё.
        csvExport: statsAllowed,
      };
    case 'creator':
      return {
        ...off,
        stats: statsAllowed,
        checklist: true,
        publications: true,
      };
    case 'manager':
    default:
      return {
        ...off,
        stats: statsAllowed,
        checklist: true,
        publications: true,
        internalComments: true,
        roster: true,
        autoping: true,
        batchScheduling: true,
        csvExport: true,
      };
  }
}
