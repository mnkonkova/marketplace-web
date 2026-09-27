import { ProjectKind } from '@entities/project/model/project.types';
// Типы домена «выкладки» — соответствуют DTO из
// marketplace-api/internal/publications/dto.go и report.go.
// Поля с omitempty в Go здесь optional.

// Площадки, на которые уходит один и тот же ролик. Порядок фиксирован
// бэком (AllPlatforms) и он же — порядок колонок в интерфейсе.
export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'vk' | 'likee';

export const ALL_PLATFORMS: readonly Platform[] = [
  'tiktok',
  'instagram',
  'youtube',
  'vk',
  'likee',
] as const;

// planned         → дата стоит, ссылок нет
// partial         → пришла часть площадок
// done            → пришли все пять
// closed_manually → менеджер закрыл неполную выкладку с причиной
// cancelled       → выкладка отменена
export type PublicationStatus = 'planned' | 'partial' | 'done' | 'closed_manually' | 'cancelled';

export type DateRequestStatus = 'pending' | 'approved' | 'rejected';

export interface SubmittedLink {
  id: string;
  publication_id: string;
  platform: Platform;
  url: string;
  url_canonical: string;
  external_media_id?: string;
  submitted_at: string;
  last_collected_at?: string;
}

// DateRequest — просьба креатора перенести дедлайн. Дату ставит менеджер,
// креатор может только попросить.
export interface DateRequest {
  id: string;
  publication_id: string;
  requested_date: string;
  reason: string;
  status: DateRequestStatus;
  decided_by?: string;
  decided_at?: string;
  created_at: string;
}

export interface Publication {
  id: string;
  project_id: string;
  creator_user_id: string;
  // Считается в запросе (specialist_profile → client_profile → префикс
  // email), в таблице выкладок его нет. Пустым приходит только у людей
  // без профиля и без почты — тогда показываем «Без имени».
  creator_name?: string;
  // Название ролика, которое дал креатор при сдаче. У запланированной
  // выкладки его нет: тему задаёт дата, а что снято — известно только
  // после съёмки.
  title?: string;
  due_date: string;
  draft_due_date?: string;
  status: PublicationStatus;
  // Выкладку завёл себе сам креатор — сверх плана, чтобы добрать до
  // ступени. Приходит только у таких: у плановых ключа НЕТ вовсе,
  // поэтому проверяется наличие поля, а не значение (isSelfAdded в
  // lib/extra-publication.ts).
  //
  // Оклада это не касается: знаменатель недосдачи считается только по
  // плановым выкладкам. И срока черновика у такой выкладки не бывает —
  // черновик это договорённость о поручённой работе.
  self_added?: boolean;
  closed_by?: string;
  close_reason?: string;
  batch_id?: string;
  created_at: string;
  updated_at: string;
  links: SubmittedLink[];
  // Считается на бэке: зависит от текущей даты и от того, не висит ли
  // просьба о переносе.
  overdue: boolean;
  pending_date_request?: DateRequest;
  // Сумма по всем пяти площадкам выкладки, по последнему снимку каждой
  // ссылки. Порог «миллион на ролик» считается по ролику целиком, поэтому
  // суммой пользуются и уведомления, и интерфейс — складывать её из
  // videos_table значило бы держать вторую реализацию того же правила.
  views: number;
  likes: number;
  comments: number;
  // Репосты по всем площадкам выкладки. Пусто, если хоть одна площадка их
  // не отдаёт: ноль означал бы «репостов нет», а это другое утверждение.
  shares?: number;
  // Вовлечённость: (лайки + комментарии + репосты) ÷ просмотры. Считает
  // сервер — на фронте её больше не собирают из лайков: правило одно, и
  // второй копии у него быть не должно.
  er_percent?: number;
  // Посчитана без репостов, то есть занижена: площадка их не отдала либо
  // ролик собирали до того, как мы начали их писать. Прошлое не
  // пересчитывается, так что у старых роликов признак останется навсегда.
  er_without_shares?: boolean;
  // Самый свежий сбор среди площадок выкладки.
  stats_collected_at?: string;
  // Когда ролик вышел: самая ранняя известная дата среди площадок.
  // Пусто — не знаем: площадки даты не отдали или ролик ещё не собирали.
  // Подставлять сюда дату сдачи ссылок нельзя — сдают и через неделю
  // после выхода, и возраст ролика («зрелый» = 14 дней) поехал бы.
  published_at?: string;
  // Проверка ролика менеджером. Ключа НЕТ, пока ролик не смотрели, и
  // это не то же самое, что «принят» или «замечаний нет»: статус
  // выкладки говорит про ссылки, а проверка — про содержание.
  review?: PublicationReview;
}

// ---- проверка ролика ----
//
// Вторая сторона чек-листа. Креатор отмечает «я сделал», менеджер —
// «я проверил»; вся польза в том, что они расходятся.

export type ReviewStatus = 'in_review' | 'returned' | 'accepted';

export interface ReviewMark {
  item_id: string;
  // «Да» или «нет». Отсутствие строки — третье состояние, «ещё не
  // смотрел», и оно не равно «нет».
  passed: boolean;
}

export interface PublicationReview {
  status: ReviewStatus;
  // Замечание последнего решения; при возврате оно обязательно.
  comment?: string;
  // Какая это по счёту сдача. Больше единицы — ролик уже возвращали.
  round: number;
  decided_by?: string;
  decided_by_name?: string;
  decided_at?: string;
  marks: ReviewMark[];
}

// Решение менеджера. Пусто — сохранить ход проверки, не вынося решения:
// ролик смотрят частями, и отметки не должны теряться между заходами.
export type ReviewDecision = '' | 'return' | 'accept';

// Пункт чеклиста в снимке проекта. platform=null — общий пункт.
export interface ChecklistItem {
  id: string;
  project_id: string;
  text: string;
  platform?: Platform;
  is_required: boolean;
  sort_order: number;
  // Пункт завёл менеджер под этот проект, а не скопирован из библиотеки.
  // Обновление шаблона такие пункты не трогает — и на экране они обязаны
  // отличаться, иначе менеджер не знает, что уцелеет при обновлении.
  added_for_project?: boolean;
}

// ---- отчёт ----

export interface DayPoint {
  date: string;
  views: number;
}

export interface PlatformRow {
  platform: Platform;
  videos: number;
  views: number;
  likes: number;
  comments: number;
  // Пусто — площадка репостов не отдаёт; ноль значил бы «их нет».
  shares?: number;
  er_percent?: number;
  // ER площадки посчитан без репостов и потому занижен.
  er_without_shares?: boolean;
}

export interface CreatorRow {
  creator_user_id: string;
  creator_name?: string;
  videos: number;
  views: number;
  avg_views: number;
  // Доля в общем результате проекта.
  share_percent: number;
}

export interface VideoRow {
  publication_id: string;
  link_id: string;
  creator_user_id: string;
  creator_name?: string;
  platform: Platform;
  url: string;
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  // Без просмотров ER не существует — бэк поле не присылает вовсе
  // (`omitempty` над указателем). Ноль вместо пропуска врал бы: «делить
  // не на что» и «вовлечённость нулевая» — разные вещи.
  er_percent?: number;
  er_without_shares?: boolean;
  // Прирост ЗА СУТКИ: разница с вчерашним снимком. null — вчерашнего
  // снимка нет, и прирост неизвестен. Ноль означал бы «ролик встал», а
  // это другое утверждение.
  growth_24h: number | null;
  submitted_at: string;
  collected_at?: string;
}

export interface PublicationReport {
  project_id: string;
  as_of: string;
  videos: number;
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  // Как и у строки ролика: без просмотров поля нет.
  er_percent?: number;
  // Хоть одна площадка, вошедшая в расчёт, репостов не отдала: показатель
  // занижен, и сказать об этом обязаны.
  er_without_shares?: boolean;
  // Прирост за сутки по всем роликам. null, если хоть по одной ссылке
  // вчерашнего снимка нет: сложить известные с неизвестными и выдать за
  // полное число — то же занижение, только спрятанное.
  growth_24h: number | null;
  // Стоимость проекта за период, копейки. Приходит только у вида, где
  // сумму называет менеджер: там начислений по людям нет, а «во сколько
  // обошёлся просмотр» спрашивают так же. Поля нет — сумму не назвали
  // либо вид не тот.
  cost?: number;
  // Стоимость тысячи просмотров, копейки. Считает сервер той же
  // формулой, что и в начислениях, — чтобы у менеджера и у заказчика не
  // получилось двух разных СПВ. Без просмотров поля нет: ноль читался бы
  // как «бесплатно».
  cost_per_1000?: number;
  // Проект закрыт — подробные строки больше не хранятся.
  collapsed: boolean;
  by_day: DayPoint[];
  by_platform: PlatformRow[];
  by_creator: CreatorRow[];
  videos_table: VideoRow[];
}

// ---- взгляд клиента ----

export type ClientVideoStatus = 'published' | 'planned';

export interface ClientVideo {
  publication_id: string;
  creator_user_id: string;
  creator_name?: string;
  title?: string;
  published_at?: string;
  platforms: Platform[];
  links: string[];
  views: number;
  likes: number;
  comments: number;
  collected_at?: string;
  // Цифры скрыты настройкой проекта. Отдельное поле, а не молчаливые нули:
  // ноль читается как «никто не смотрел».
  stats_hidden: boolean;
}

export interface CalendarItem {
  publication_id: string;
  creator_user_id: string;
  creator_name?: string;
  status: ClientVideoStatus;
}

export interface CalendarDay {
  date: string;
  planned: number;
  published: number;
  items: CalendarItem[];
}

export interface CalendarResponse {
  month: string;
  days: CalendarDay[];
  // Месяцы (ГГГГ-ММ), в которых у проекта вообще есть выкладки. Сетка
  // показывает один месяц, и без этого списка пустой месяц неотличим от
  // «данные не доехали»: выкладки могут стоять в соседнем.
  months?: string[];
}

export interface NotificationPrefs {
  project_id: string;
  user_id: string;
  on_new_video: boolean;
  on_weekly_digest: boolean;
  on_date_shift: boolean;
  // null/0 — «не уведомлять о просмотрах».
  views_threshold?: number;
}

export interface NotificationPrefsPatch {
  on_new_video?: boolean;
  on_weekly_digest?: boolean;
  on_date_shift?: boolean;
  views_threshold?: number;
}

// ---- пачки выкладок (менеджер) ----

export type BatchScheme = 'daily' | 'weekdays' | 'tue_thu' | 'every_other_day';

export interface BatchRequest {
  creator_user_ids: string[];
  // Либо scheme + from/to, либо произвольный список dates (ГГГГ-ММ-ДД).
  scheme?: BatchScheme;
  from?: string;
  to?: string;
  dates?: string[];
  draft_lead_days?: number;
}

export interface BatchPreview {
  dates: string[];
  total: number;
}

export interface BatchResult {
  batch_id: string;
  created: number;
  items: Publication[];
}

// ---- список «мои проекты» у креатора ----

// Проект, где я в действующем составе. Счётчики — только по своим
// выкладкам: чужие креатор не видит нигде, и здесь тоже. Полной карточки
// проекта для креатора в API пока нет — есть только эта строка списка.
export interface CreatorProject {
  project_id: string;
  title: string;
  kind: ProjectKind;
  status: string;
  added_at: string;
  publications_total: number;
  publications_open: number;
  publications_overdue: number;
  // Ближайший срок из несданного. Пусто, когда сдано всё.
  next_due_date?: string;
}

// Карточка проекта глазами креатора: шапка страницы выкладок. Раньше её
// собирали из списка выкладок, а брифа и месячного плана там взять было
// неоткуда.
export interface CreatorProjectCard extends CreatorProject {
  // Что делаем. Лежит в projects.notes.
  brief?: string;
  // Период проекта. due_date у проекта с креаторами обычно пуст: сроки
  // стоят у выкладок, а не у проекта.
  started_at?: string;
  due_date?: string;
  // Сколько роликов за месяц по договору — из него «6 из 12» в шапке.
  monthly_plan: number;
  // У выкладки два срока: сдать черновик и выложить.
  draft_required: boolean;
  // Кому писать. Пусто, пока проект никто не взял.
  manager?: ProjectPerson;
  // Пять площадок списком — чтобы у фронта не было своей копии порядка.
  platforms?: Platform[];
  /**
   * Своя медиана просмотров. Из неё считается «следующий ролик добавит
   * примерно столько» — то есть обещание, поэтому число типичное, а не
   * среднее. Пусто, пока мерить не на чем.
   */
  median?: CreatorMedian;
}

/**
 * Найденный на площадке ролик, ждущий ответа «мой / не мой».
 *
 * Сервис видит ролик раньше, чем креатор успевает вставить ссылку, но
 * ничего не привязывает сам: ошибка сопоставления припишет человеку
 * чужую работу, и узнают об этом из счёта.
 */
export interface LinkSuggestion {
  id: string;
  project_id: string;
  project_title: string;
  creator_user_id: string;
  platform: Platform;
  url: string;
  title?: string;
  author_handle?: string;
  published_at?: string;
  created_at: string;
  /**
   * Выкладка, к которой предлагаем привязать. Считается сервером при
   * чтении, поэтому перенос срока подсказку не ломает. Пусто —
   * подходящей выкладки сейчас нет.
   */
  suggested_publication_id?: string;
  suggested_due_date?: string;
}

// ---- материалы проекта ----

// creators — бренд-гайд и обучение: открывается креатору в момент
// добавления в проект. client — то, что видно заказчику. Клиенту
// креаторские материалы не отдаёт и сам бэк.
/**
 * Доступ к аккаунту бренда: где и под каким логином выходят ролики.
 *
 * Заполняет менеджер, видит заказчик — это его аккаунты. Пароля в этом
 * типе нет намеренно: он не ездит в списке проекта, его запрашивают
 * отдельной ручкой, и по этому запросу видно, кто его брал.
 */
export interface ProjectAccount {
  id: string;
  project_id: string;
  /**
   * Чей это аккаунт. Ролики выходят с аккаунтов КРЕАТОРОВ, и список без
   * владельца читается как чужая связка ключей: видно пять строк и
   * непонятно, с кого спрашивать, когда ссылка перестала отвечать.
   *
   * Пусто у настоящих брендовых доступов — почты, рекламного кабинета,
   * аккаунта самого бренда.
   */
  creator_user_id?: string;
  /** Подпись владельца. Считает сервер, в таблице доступов её нет. */
  creator_name?: string;
  /** Пятёрка площадок плюс other: доступ бывает и к почте, и к кабинету. */
  platform: Platform | 'other';
  title: string;
  url: string;
  login: string;
  /** Пароль заведён. Само значение — отдельным запросом. */
  has_password: boolean;
  note: string;
  sort_order: number;
  created_at: string;
}

export interface ProjectAccountInput {
  /** Чей аккаунт. Пусто — доступ без владельца, брендовый. */
  creator_user_id?: string;
  platform: Platform | 'other';
  title?: string;
  url?: string;
  login?: string;
  /** Не передан — пароль не трогаем; пустая строка — стираем. */
  password?: string;
  note?: string;
}

export interface ProjectAccountsResponse {
  items: ProjectAccount[];
  /**
   * Можно ли заводить пароли. Выключено, когда у сервиса нет ключа
   * шифрования: логины и ссылки при этом работают, и сказать об этом
   * надо словами, а не спрятать поле.
   */
  secrets_enabled: boolean;
}

export type MaterialAudience = 'creators' | 'client';

export type MaterialKind = 'doc' | 'video' | 'link';

export interface Material {
  id: string;
  project_id: string;
  title: string;
  kind: MaterialKind;
  url: string;
  audience: MaterialAudience;
  sort_order: number;
  created_by: string;
  created_at: string;
}

export interface MaterialInput {
  title: string;
  kind: MaterialKind;
  url: string;
  // Не передан — бэк ставит creators.
  audience?: MaterialAudience;
}

// Переключатели проекта, которыми управляет менеджер. Оба меняют работу,
// а не оформление: этап черновика добавляет выкладке второй срок, по
// которому пингует бот, а показ статистики закрывает заказчику и отчёт,
// и цифры в ленте.
export interface ProjectSettings {
  draft_required: boolean;
  client_sees_stats: boolean;
}

// ---- состав проекта ----

// Ссылки на аккаунты по пяти площадкам, из профиля специалиста.
// Заполненных может не быть вовсе: в карте лежат только те, что есть.
export type AccountLinks = Partial<Record<Platform, string>>;

export interface ProjectPerson {
  user_id: string;
  display_name: string;
  added_at: string;
  account_links?: AccountLinks;
  /**
   * Сколько просмотров человек обычно даёт за ролик. Медиана, а не
   * среднее: один залетевший ролик поднимает среднее вдвое и обещает то,
   * чего обычно не бывает. Пусто, пока измеренных роликов мало.
   */
  median?: CreatorMedian;
  /** Колокольчик в плане: писать ли этому человеку накануне срока. */
  remind_day_before?: boolean;
}

/** Медиана просмотров и то, на скольких роликах она посчитана. */
export interface CreatorMedian {
  views: number;
  /**
   * Сколько роликов легло в расчёт. Идёт вместе с числом: «медиана 190
   * тыс. по 12 роликам» и «по 3» — разной силы утверждения.
   */
  basis: number;
}

// ---- библиотека чеклистов ----

export interface ChecklistTemplate {
  id: string;
  name: string;
  description?: string;
  version: number;
  items_count: number;
}

// Пункт шаблона. Пустая площадка — общий пункт: показывается для всех.
export interface ChecklistTemplateItem {
  text: string;
  platform?: Platform | '';
  is_required: boolean;
}

// Шаблон целиком. Правки на месте нет: шаблон уходит в проект снимком, и
// подмена пунктов под идущим проектом означала бы, что креатор отмечал
// одно, а спросят с него другое. Поэтому «сохранить» — это выпустить
// следующую версию, а прежнюю погасить.
export interface ChecklistTemplateFull extends ChecklistTemplate {
  items: ChecklistTemplateItem[];
}

export interface SaveChecklistTemplateInput {
  // Какую версию заменяем. Пусто — новый шаблон.
  replaces?: string;
  name: string;
  description?: string;
  items: ChecklistTemplateItem[];
}

// Какой шаблон подключён к проекту и какой версии. Версия запоминается
// снимком в момент подключения; latest_version — что в библиотеке сейчас.
// latest_version больше template_version — значит вышло обновление.
// Приходит только у менеджера и только если чеклист подключали.
export interface ChecklistSnapshot {
  template_id: string;
  template_name: string;
  template_version: number;
  connected_at?: string;
  latest_version?: number;
}

// ---- автопинг ----

// Четыре выключателя по четырём видам напоминаний. Проект, где ничего не
// трогали, пингуется полностью: бэк отдаёт все четыре true.
export interface ReminderPrefs {
  project_id: string;
  due_today: boolean;
  overdue: boolean;
  incomplete: boolean;
  manager_digest: boolean;
  /**
   * Напомнить накануне срока — умолчание проекта. Единственный вид,
   * выключенный по умолчанию: остальные три были с самого начала и на
   * них рассчитывают, а этот появился позже. Колокольчик напротив
   * креатора в плане сильнее этой настройки.
   */
  day_before: boolean;
  updated_at?: string;
}

export type ReminderPrefsPatch = Partial<
  Pick<ReminderPrefs, 'due_today' | 'overdue' | 'incomplete' | 'manager_digest' | 'day_before'>
>;

/**
 * Заявка заказчика на следующий месяц.
 *
 * Прикидка «во сколько обойдётся месяц» сама по себе справочная:
 * посмотрел и закрыл, а дальше человек шёл писать менеджеру словами.
 * Кнопка «Заказать» превращает её в заявку — плашку у менеджера и
 * сообщение в общий чат. Это ещё не заказ: цену и состав финализирует
 * менеджер, а ceiling хранится снимком — разговор пойдёт о той сумме,
 * которую человеку показали.
 */
export interface MonthRequest {
  id: string;
  project_id: string;
  /** Первое число месяца, о котором просят. */
  month: string;
  creators: number;
  videos: number;
  /** Потолок в копейках — тот, что стоял на экране. */
  ceiling: number;
  created_at: string;
  handled_at?: string | null;
  requested_by: string;
  project_title?: string;
  client_name?: string;
}
