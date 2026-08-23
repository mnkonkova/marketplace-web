import { MeProfile, SocialLinks } from '@entities/me/model/me.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';

/** Вкладки редактора профиля `/me`. Порядок = порядок табов в UI. */
export type ProfileTabId = 'basic' | 'skills' | 'portfolio' | 'contacts' | 'publish';

export const PROFILE_TAB_IDS: ProfileTabId[] = [
  'basic',
  'skills',
  'portfolio',
  'contacts',
  'publish',
];

/**
 * Critical, важные и nice-to-have поля профиля. Каждое даёт N% к completeness.
 * Сумма = 100. Подобрано так чтобы:
 *   • base 40% сразу даётся за заполненный профиль (избегаем «3% пугающе пусто»)
 *   • публикация контента ≥ 40% — без портфолио клиенты ничего не увидят
 *   • соцсети + bio дают ещё ~20% — это «продающая» часть
 */
export interface CompletenessCheck {
  /** Внутренний id для отладки. */
  id: string;
  /** Короткое имя поля. Нужно там, где нет места на объяснение. */
  label: string;
  /**
   * Что человек получит, если заполнит. Именно это и показываем.
   *
   * «Заполнено на 60 %» и «не хватает описания» — оценка и упрёк, а не
   * причина что-то делать: человек и так знает, что не дописал. Работает
   * другое — что именно изменится в его карточке и в поведении заказчика.
   * Формулировки описывают механику («описание читают перед тем, как
   * написать»), а не выдуманную статистику: цифры вроде «в полтора раза
   * больше заявок» мы не мерили, и ставить их в интерфейс нельзя.
   */
  gain: string;
  /** Сколько процентов даёт. */
  weight: number;
  /** Готов ли пункт. */
  ok: boolean;
  /**
   * Вкладка редактора, на которой пункт закрывается. По ней шапка «Что
   * добавить (+%)» маппится на точку-бейдж у заголовка таба — иначе список
   * недостающего висит над табами и не подсказывает, куда идти.
   */
  tab: ProfileTabId;
}

/**
 * Единственный источник правды по заполненности. Раньше жил внутри
 * `CompletenessIndicatorComponent`; вынесен, потому что теми же пунктами
 * страница `/me` помечает вкладки с незаполненным.
 */
export function completenessChecks(
  profile: MeProfile | null,
  portfolio: PortfolioItem[] = [],
): CompletenessCheck[] {
  if (!profile) return [];
  const p = profile;
  const anySocial = socialAny(p.social_links ?? {});
  return [
    {
      id: 'display_name',
      label: 'Имя / название',
      gain: 'Имя видно в каталоге, в ленте и в письме заказчику.',
      weight: 5,
      ok: !!p.display_name?.trim(),
      tab: 'basic',
    },
    {
      id: 'avatar',
      label: 'Аватар или обложка',
      gain: 'Фото — первое, что видит заказчик в каталоге и ленте. Карточка без него читается как черновик.',
      weight: 10,
      ok: !!p.avatar_url?.trim(),
      tab: 'basic',
    },
    {
      id: 'bio',
      label: '«О себе» — минимум 100 символов',
      gain: 'Описание читают перед тем, как написать: по нему решают, тот ли вы человек.',
      weight: 15,
      ok: (p.bio ?? '').trim().length >= 100,
      tab: 'basic',
    },
    {
      id: 'category',
      label: 'Хотя бы одна категория',
      gain: 'Роли решают, в какие подборки и запросы вы попадаете.',
      weight: 10,
      ok: (p.categories ?? []).length > 0,
      tab: 'skills',
    },
    {
      id: 'production',
      label: 'Студия или «фрилансер»',
      gain: 'Студия или «фрилансер» — заказчик сразу понимает, с кем имеет дело.',
      weight: 5,
      ok: !!p.production_id || !!p.is_freelance,
      tab: 'basic',
    },
    {
      id: 'rate',
      label: 'Цена услуг',
      gain: 'Цена отсекает не тех: без неё пишут с бюджетом, который вам не подходит.',
      weight: 5,
      ok: (p.rate_min ?? 0) > 0 || (p.rate_max ?? 0) > 0,
      tab: 'basic',
    },
    {
      id: 'username',
      label: 'Короткий URL (username)',
      gain: 'Короткий адрес вида wayprmarket.ru/specialist/<ник> — его отправляют в личку вместо тридцати шести символов.',
      weight: 5,
      ok: !!p.username?.trim(),
      tab: 'publish',
    },
    {
      id: 'portfolio_1',
      label: 'Минимум одна работа',
      gain: 'Работы — то, по чему выбирают. Без единой карточку просто листают дальше.',
      weight: 15,
      ok: portfolio.length >= 1,
      tab: 'portfolio',
    },
    {
      id: 'portfolio_3',
      label: '3+ работы (попадание в топ)',
      gain: 'Три работы и больше — видно почерк, а не случайный ролик.',
      weight: 15,
      ok: portfolio.length >= 3,
      tab: 'portfolio',
    },
    {
      id: 'social',
      label: 'Хотя бы одна соцсеть для контакта',
      gain: 'Соцсети дают посмотреть вас до письма — это снимает половину вопросов.',
      weight: 10,
      ok: anySocial,
      tab: 'contacts',
    },
    {
      id: 'contact',
      label: 'Email или телефон',
      gain: 'Почта или телефон — способ ответить вам, минуя переписку на сайте.',
      weight: 5,
      ok: !!p.contact_email?.trim() || !!p.contact_phone?.trim(),
      tab: 'contacts',
    },
  ];
}

export function completenessPercent(checks: CompletenessCheck[]): number {
  if (checks.length === 0) return 0;
  return checks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0);
}

/** Сколько процентов «недобрано» на каждой вкладке. 0 = вкладка закрыта. */
export function missingWeightByTab(checks: CompletenessCheck[]): Record<ProfileTabId, number> {
  const acc: Record<ProfileTabId, number> = {
    basic: 0,
    skills: 0,
    portfolio: 0,
    contacts: 0,
    publish: 0,
  };
  for (const c of checks) {
    if (!c.ok) acc[c.tab] += c.weight;
  }
  return acc;
}

function socialAny(s: SocialLinks): boolean {
  if (!s) return false;
  for (const k of Object.keys(s) as Array<keyof SocialLinks>) {
    if ((s[k] ?? '').toString().trim()) return true;
  }
  return false;
}
