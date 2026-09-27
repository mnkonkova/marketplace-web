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
  // Проверка ролика менеджером перед закрытием выкладки
  // (app-project-review). Проверять чужую работу есть смысл там, где её
  // делают люди со стороны; ролик с аккаунта бренда снимает сам бренд.
  review: boolean;
  // Аккаунты проекта, с которых выходят ролики (app-project-accounts).
  accounts: boolean;
  // Материалы проекта: сценарии, исходники, бренд-бук
  // (app-project-materials).
  materials: boolean;
  // Начисления, выплаты и маржа (app-project-billing). Начисляют людям,
  // поэтому блок бывает только там, где люди есть.
  billing: boolean;
  // Поле «сколько стоит проект» и СПВ, посчитанная по нему. Бывает
  // ровно там, где нет начислений: у проекта без креаторов сумма не
  // складывается из начислений людям — людей нет, — и её называет
  // менеджер одним числом. СПВ считается по этому числу, иначе цену
  // просмотра у такого проекта не с чем было бы сравнить.
  cost: boolean;
  // В проекте работают люди со стороны.
  //
  // Не то же самое, что `roster`: тот про БЛОК со ссылками на аккаунты,
  // а это про сам факт — есть ли у проекта креаторы. У проекта без
  // креаторов ролики выходят с аккаунтов бренда, и всё, что спрашивает
  // «чей ролик» и «сколько людей в команде», у заказчика превращается в
  // пустую колонку на всю таблицу и в прикидку цены по числу людей,
  // которых не бывает.
  crew: boolean;
}

export interface ProjectBlocksInput {
  // Вид проекта. План выкладок бывает у creators_turnkey и brand_turnkey;
  // у остальных блоки лишние. Раньше это определялось по данным — пустая
  // лента при пустом календаре считалась проектом по воронке, — и новый
  // проект с ещё не проставленными датами выглядел так же, как проект,
  // где выкладок не бывает вовсе.
  //
  // undefined — карточка ещё не загрузилась, вид неизвестен. Тогда
  // блоков нет: подставлять вид по умолчанию нельзя, иначе проект
  // чужого вида полсекунды рисуется как проект с креаторами.
  kind: ProjectKind | undefined;
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
    review: false,
    accounts: false,
    materials: false,
    billing: false,
    cost: false,
    crew: false,
  };

  switch (kind) {
    case 'creators_turnkey':
      return creatorsTurnkeyBlocks(role, off, statsAllowed);
    case 'brand_turnkey':
      return brandTurnkeyBlocks(role, off, statsAllowed);
    // production_turnkey, general и ещё не загруженная карточка: плана
    // выкладок нет, показывать нечего.
    default:
      return off;
  }
}

// Общая часть заказчикова кабинета у обоих видов с планом выкладок:
// лента, календарь, цифры и бот выглядят одинаково — ему неважно, кто
// снимает ролики. Различает их только `crew`, который каждая ветка
// дописывает сама: у проекта без креаторов из кабинета уходят колонка
// «чей ролик», «Команда периода» и прикидка месяца по числу людей.
function planClientBlocks(off: ProjectBlocks, statsAllowed: boolean): ProjectBlocks {
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
}

function creatorsTurnkeyBlocks(
  role: ProjectViewerRole,
  off: ProjectBlocks,
  statsAllowed: boolean,
): ProjectBlocks {
  switch (role) {
    case 'client':
      return { ...planClientBlocks(off, statsAllowed), crew: true };
    case 'creator':
      return {
        ...off,
        crew: true,
        stats: statsAllowed,
        checklist: true,
        publications: true,
        materials: true,
      };
    case 'manager':
    default:
      return {
        ...off,
        crew: true,
        stats: statsAllowed,
        checklist: true,
        publications: true,
        internalComments: true,
        roster: true,
        autoping: true,
        batchScheduling: true,
        csvExport: true,
        review: true,
        accounts: true,
        materials: true,
        billing: true,
      };
  }
}

function brandTurnkeyBlocks(
  role: ProjectViewerRole,
  off: ProjectBlocks,
  statsAllowed: boolean,
): ProjectBlocks {
  switch (role) {
    case 'client':
      return planClientBlocks(off, statsAllowed);
    // Роли креатора у такого проекта не существует: ролики выходят с
    // аккаунтов бренда, приглашать в проект некого. Кабинета креатора
    // тут нет, и если он всё же открыт — показывать нечего.
    case 'creator':
      return off;
    case 'manager':
    default:
      return {
        ...off,
        stats: statsAllowed,
        publications: true,
        internalComments: true,
        autoping: true,
        batchScheduling: true,
        csvExport: true,
        accounts: true,
        materials: true,
        // Начислений нет — вместо них менеджер называет стоимость
        // проекта, и СПВ считается по ней.
        cost: true,
      };
  }
}
