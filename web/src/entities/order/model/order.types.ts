import type { BillingTerms } from '@entities/billing/model/billing.types';

// Типы домена «заказ на подбор креаторов под ключ» — DTO из
// marketplace-api/internal/orders/dto.go.

// submitted — заявка отправлена: заказ и проект заведены, менеджер
// считает. finalized — менеджер утвердил состав, цену и даты; дальше
// живёт проект, а заказ становится историей сделки.
export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'inviting'
  | 'staffed'
  | 'finalized'
  | 'paid'
  | 'cancelled';

// responded — креатор откликнулся на рассылку: прислал файл или указал
// свои ролики. Это НЕ «согласился»: согласие подтверждает менеджер,
// когда добавляет человека в состав.
export type CandidateStatus =
  | 'reserve'
  | 'invited'
  | 'responded'
  | 'accepted'
  | 'declined'
  | 'expired';

// Как креатор ответил на рассылку.
//
//   attach         — приложил файл в кабинете;
//   upload         — прислал файл в бот, и он лёг ещё и в портфолио;
//   from_portfolio — показал уже загруженные ролики;
//   decline        — отказался. Это тоже ответ: «сказал нет» и «молчит»
//                    для менеджера разные вещи.
export type ResponseMode = 'attach' | 'upload' | 'from_portfolio' | 'decline';

// Ролик из портфолио, приложенный к отклику.
export interface OrderResponseItem {
  id: string;
  title: string;
  video_url?: string;
  preview_url?: string;
  thumbnail_url?: string;
}

// Отклик креатора — как его видит менеджер, собирая состав.
export interface OrderResponse {
  order_id: string;
  creator_user_id: string;
  creator_name?: string;
  avatar_url?: string;
  // Заказчик отметил этого человека «хочу особенно». Из двадцати
  // согласных начинают с тех, кого просили.
  is_preferred: boolean;
  // Уже в составе проекта: без этого менеджер жмёт «Взять в проект»
  // второй раз и получает отказ вместо ответа.
  in_crew: boolean;
  mode: ResponseMode;
  file_url?: string;
  note?: string;
  items?: OrderResponseItem[];
  created_at: string;
}

export interface OrderCandidate {
  order_id: string;
  creator_user_id: string;
  // Имя кандидата: заказчик отмечает людей, а не uuid.
  creator_name?: string;
  // Заказчик отметил этого человека: «хочу особенно его». Это НЕ
  // приоритет очереди — очереди больше нет, приглашение уходит всем
  // сразу. Отметка идёт в текст приглашения и показывается менеджеру,
  // когда он собирает состав из откликнувшихся.
  is_preferred: boolean;
  // Порядок, в котором заказчик их отметил. Смысла очереди у него нет;
  // остался как устойчивая сортировка, чтобы список не прыгал.
  priority: number;
  status: CandidateStatus;
  invited_at?: string;
  responded_at?: string;
  expires_at?: string;
}

// Какой проект вырастает из заявки. Ровно два значения: заявка
// порождает либо проект с креаторами, либо проект без них — «видео под
// ключ», где снимаем мы и ролики выходят с аккаунтов бренда.
export type OrderProjectKind = 'creators_turnkey' | 'brand_turnkey';

export interface Order {
  id: string;
  client_user_id: string;
  project_id?: string;
  // Ветка воронки. Хранится в заказе, а не выводится из состава:
  // «никого не отметили» бывает в обеих.
  project_kind: OrderProjectKind;
  terms_version_id?: string;
  start_month: string;
  needed: number;
  videos_count: number;
  status: OrderStatus;
  candidates: OrderCandidate[];
  // Считаются на бэке, не хранятся.
  accepted: number;
  need_more: number;
  // Сколько ещё можно позвать без участия клиента. Ноль при need_more > 0 —
  // это и есть момент «добрать», когда подключается менеджер.
  reserve_left: number;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

// Взгляд креатора на приглашение.
export interface Invitation {
  order_id: string;
  client_user_id: string;
  start_month: string;
  videos_count: number;
  status: CandidateStatus;
  invited_at?: string;
  expires_at?: string;
  // Заказчик отметил именно вас. Приписка в том же приглашении, а не
  // отдельное письмо: два сообщения об одной заявке выглядят
  // беспорядком.
  is_preferred?: boolean;
  // Когда заявка ушла рассылкой. Отличает «позвали лично» от «пришло
  // вместе со всеми» — это разные разговоры.
  broadcast_at?: string;
  // О чём заявка. Без них приглашение — это «30 роликов в октябре», и
  // решать по нему нечего.
  title?: string;
  brief?: string;
  // Уже ответил, и вот как. Пусто — ещё нет.
  responded?: ResponseMode;
}

// Отметка занятости в месяце. Приходят ТОЛЬКО отмеченные месяцы:
// не отмеченный в выдачу не попадает вовсе, и считать его свободным
// нельзя — «не отмечал» и «свободен» это разные состояния.
export interface Availability {
  creator_user_id: string;
  month: string;
  is_available: boolean;
}

export interface OrderTerms {
  id: string;
  version: number;
  body: string;
  published_at: string;
  // Прайс той же версии: клиент соглашается не с текстом отдельно и
  // ставками отдельно, а с одним документом. Копейки.
  salary_per_month: number;
  videos_first_month: number;
  videos_next_months: number;
  rate_per_1000_views: number;
  bonus_views_threshold: number;
  rate_per_1000_views_over: number;
  click_bonus_rate?: number;
  click_bonus_threshold: number;
  click_bonus_rate_over?: number;
  // Фикс за ВЫШЕДШИЙ РОЛИК. Пусто — версия старая, фикс платится
  // окладом за период. На этом экране человек нажимает «согласен», и
  // цена здесь обязана быть той, по которой ему выставят счёт.
  fee_per_video?: number | null;
}

// Смета — из marketpclce/internal/billing/estimate.go. Живёт рядом с
// заказом, а не в billing: клиент видит её до того, как заказ появится,
// и считается она по составу подборки.

export interface CreatorForecast {
  creator_user_id: string;
  creator_name?: string;
  // Среднее по его сданным роликам, суммой по пяти площадкам.
  avg_views_per_video: number;
  // На скольких роликах основано среднее. Ноль — истории нет, и это
  // разное с «ноль просмотров».
  based_on_videos: number;
}

/**
 * Ступень ГЛАЗАМИ ОДНОЙ СТОРОНЫ: порог и цена на нём.
 *
 * Это не TariffStep из billing: у того две цены сразу — клиента и
 * креатора, — а сюда сервер отдаёт уже сведённые к стороне смотрящего
 * (internal/billing/client_view.go, SideStep), и поле называется `fee`.
 * Пока здесь стоял TariffStep, код читал `client_fee`, получал
 * undefined и молча считал потолок нулём — ступеней как будто не было
 * вовсе.
 */
export interface SideStep {
  from_views: number;
  fee: number;
}

/**
 * Тариф стороны: те же поля прайса, но лесенка СВОЯ.
 *
 * Omit обязателен: у BillingTerms поле `steps` своего типа (две цены в
 * строке), и пересечение типов дало бы ступень, у которой нет ни одного
 * читаемого поля цены.
 */
export type SideTerms = Omit<BillingTerms, 'steps'> & { steps?: SideStep[] };

/**
 * Бриф заявки: о чём снимаем. Первый шаг воронки «под ключ».
 *
 * Необязателен целиком: заявка с пустым брифом лучше формы, которую
 * бросили на полпути, а дописать его можно и после отправки.
 */
export interface OrderBrief {
  goal: string;
  product: string;
  audience: string;
  tone: string;
  refs: string;
  platforms?: string[];
}

export interface OrderEstimate {
  // Версия правил, по которой названа цена. У созданного заказа — та, с
  // которой согласился клиент, а не действующая сегодня.
  terms: SideTerms;
  creators: number;
  videos: number;
  // Оклады — единственная точно известная часть.
  salaries: number;
  avg_views_per_video: number;
  views_forecast: number;
  bonus_forecast: number;
  total: number;
  forecast: CreatorForecast[];
  // По скольким из подборки истории нет: прогноз опирается на остальных.
  without_history: number;
  // false — бонус НЕИЗВЕСТЕН, а не равен нулю. Показывать в этом случае
  // можно только оклады.
  has_forecast: boolean;
}

// Сколько креаторов доступно клиенту на месяц старта.
export interface OrderLimit {
  month: string;
  allowed: number;
  // Нижняя граница вилки «доступно 2–3». Взять меньше не запрещено.
  min_allowed: number;
  // Сколько оплаченных месяцев будет закрыто к началу month. Ноль
  // объясняет, почему доступен один: месяцев работы пока нет.
  completed_months: number;
  first_month: boolean;
}
