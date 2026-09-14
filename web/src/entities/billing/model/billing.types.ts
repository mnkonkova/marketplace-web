// Типы домена «деньги проекта» — DTO из marketplace-api/internal/billing.
//
// ВСЕ СУММЫ В КОПЕЙКАХ. Делить на 100 только при показе, считать — никогда:
// деление на тысячу просмотров в целых рублях расходится в последнем знаке,
// и «746 ₽ за 1000» у менеджера и заказчика получались разными.

// Условия проекта — снимок, а не ссылка на действующий прайс: правка
// прайса не переписывает историю уже идущего проекта.
export interface BillingTerms {
  project_id: string;
  // Оклад креатора за месяц.
  salary_per_month: number;
  // За какой объём назван оклад: «30 видео первый месяц, 60 со второго».
  // Без этой подписи сумма оклада ни о чём не говорит.
  videos_first_month?: number;
  videos_next_months?: number;
  // Ставка за тысячу просмотров до порога и свыше. Вторая ниже намеренно:
  // так виральный ролик не съедает бюджет заказчика.
  rate_per_1000_views: number;
  rate_per_1000_views_over: number;
  // Порог НА РОЛИК, суммой по пяти площадкам. 0 — порога нет, весь объём
  // идёт по полной ставке.
  bonus_views_threshold: number;
  // Переходы устроены так же, но порог здесь МЕСЯЧНЫЙ. click_bonus_rate
  // пустой — источник кликов не подключён, бонус не считается, поля в
  // тарифе есть.
  click_bonus_rate?: number;
  click_bonus_rate_over?: number;
  click_bonus_threshold?: number;
  // Креаторская сторона тарифа: что получает исполнитель. Пусто — «столько
  // же, сколько платит клиент»: до заполнения этих полей выплата равна
  // счёту и маржи у платформы нет. Две стороны нужны потому, что это
  // разные деньги: счёт заказчику и обязательство перед креатором.
  creator_salary_per_month?: number;
  creator_rate_per_1000_views?: number;
  creator_rate_per_1000_views_over?: number;
  // С какой версии прайса сняты числа. Только для истории.
  terms_version_id?: string;
  updated_at?: string;
}

export interface BillingTermsInput {
  salary_per_month: number;
  rate_per_1000_views: number;
  rate_per_1000_views_over: number;
  bonus_views_threshold: number;
  videos_first_month?: number;
  videos_next_months?: number;
  // null — выключить бонус за переходы: источник кликов не подключён.
  // Отличается от 0, который значит «ставка задана и равна нулю».
  click_bonus_rate?: number | null;
  click_bonus_rate_over?: number | null;
  click_bonus_threshold?: number | null;
  // null — «как у клиента»: платформа ничего не удерживает.
  creator_salary_per_month?: number | null;
  creator_rate_per_1000_views?: number | null;
  creator_rate_per_1000_views_over?: number | null;
}

// ---- прайс площадки (админ) ----
//
// Версия прайса не правится, а выпускается заново: под старой стоит
// согласие клиентов, а проекты сняли с неё числа снимком. Поэтому в
// админке нет «сохранить» — есть «выпустить новую версию».

export interface TermsVersion extends BillingTerms {
  id?: string;
  version: number;
  // Текст условий, с которым соглашается клиент.
  body: string;
  published_at: string;
  // Действует всегда одна версия — самая новая.
  is_current: boolean;
  // Сколько клиентов согласились именно с ней и сколько проектов сняли
  // с неё числа: показывает, что версию нельзя считать черновиком.
  consented_clients: number;
  used_by_projects: number;
}

export interface PublishTermsInput extends BillingTermsInput {
  body: string;
}

// Платёж заказчика. Провайдера нет: деньги приходят мимо системы, и
// менеджер подтверждает получение — поэтому подтверждение именное.
export type PaymentKind = 'prepayment' | 'final';

// awaiting — счёт выставлен, денег ещё нет; confirmed — менеджер
// подтвердил получение; cancelled — платёж отменён.
export type PaymentStatus = 'awaiting' | 'confirmed' | 'cancelled';

export interface Payment {
  id: string;
  project_id: string;
  kind: PaymentKind;
  // Сколько ждём, копейки.
  amount: number;
  status: PaymentStatus;
  note?: string;
  confirmed_at?: string;
  confirmed_by?: string;
  created_at: string;
}

export interface PaymentInput {
  amount: number;
  note?: string;
}

// draft → approved → paid. Утверждённая строка пересчётом не трогается —
// это и есть «период закрыт»; выплатить неутверждённую нельзя.
export type AccrualStatus = 'draft' | 'approved' | 'paid';

export interface Accrual {
  id: string;
  // Строка посчитана сервером на лету, в базе её нет: так выглядит месяц,
  // который ещё не пересчитывали. Цифры настоящие, но утвердить и
  // выплатить такую строку нельзя — сперва её сохраняет «Пересчитать».
  is_preview?: boolean;
  project_id: string;
  creator_user_id: string;
  creator_name?: string;
  // Первое число месяца.
  period_month: string;
  status: AccrualStatus;
  // Каким по приоритету человек попал в подборку заказа: «приоритет 1»
  // в «Команде месяца» у заказчика. 0 — проект заведён руками, и строку
  // «собрана по вашему приоритету» показывать не надо.
  priority?: number;
  salary: number;
  // Просмотры по ступеням тарифа: base — то, что попало под полную ставку
  // (до порога на каждом ролике), over — то, что сверх. Обе части, потому
  // что по одному итогу не разобрать, почему бонус именно такой.
  views_base: number;
  views_over: number;
  views_total: number;
  views_bonus: number;
  clicks: number;
  click_bonus: number;
  // Недосданное не оплачивается, вычет пропорционален недостаче.
  videos_planned: number;
  videos_delivered: number;
  deduction: number;
  total: number;
  calculated_at?: string;
  approved_at?: string;
  paid_at?: string;
}

// Итог периода. Считается на сервере из тех же строк: складывать их ещё
// раз на фронте значит получить на двух экранах два разных числа.
export interface PeriodTotals {
  salaries: number;
  views_bonus: number;
  click_bonus: number;
  deductions: number;
  total: number;
  views: number;
  // Сколько выкладок стояло и сколько закрыто: «по 6 роликам» в шапке
  // считается отсюда, а не сложением строк.
  videos: number;
  videos_delivered: number;
  // Во сколько обошлась тысяча просмотров. Пусто, пока просмотров нет —
  // делить не на что.
  cost_per_1000?: number;
}

// UTM-метка креатора. Ставит менеджер, креатор только видит.
export interface UtmLink {
  creator_user_id: string;
  creator_name?: string;
  url: string;
  // Заполняется снаружи, из аналитики. Пока бонус за переходы выключен,
  // число справочное.
  clicks: number;
  updated_at?: string;
}

export interface ProjectBilling {
  terms?: BillingTerms;
  payments?: Payment[];
  // За запрошенный месяц. Заказчик их тоже видит: в макете это «Команда
  // месяца» — кто сколько роликов сдал и во сколько это обошлось. Он за
  // них и платит, поэтому «60 000 + 5 850» — его счёт, а не чужая
  // зарплата. UTM-меток у него по-прежнему нет: это инструмент менеджера.
  accruals?: Accrual[];
  utm?: UtmLink[];
  totals?: PeriodTotals;
  period_month?: string;
}

// Взгляд креатора: условия, свои начисления по всем месяцам проекта
// (свежие первыми) и своя метка. Чужих цифр здесь нет.
export interface CreatorEarnings {
  terms?: BillingTerms;
  accruals?: Accrual[];
  utm?: UtmLink;
}
