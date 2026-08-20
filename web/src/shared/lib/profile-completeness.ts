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
  /** Что отображать юзеру в подсказке. */
  label: string;
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
      weight: 5,
      ok: !!p.display_name?.trim(),
      tab: 'basic',
    },
    {
      id: 'avatar',
      label: 'Аватар или обложка',
      weight: 10,
      ok: !!p.avatar_url?.trim(),
      tab: 'basic',
    },
    {
      id: 'bio',
      label: '«О себе» — минимум 100 символов',
      weight: 15,
      ok: (p.bio ?? '').trim().length >= 100,
      tab: 'basic',
    },
    {
      id: 'category',
      label: 'Хотя бы одна категория',
      weight: 10,
      ok: (p.categories ?? []).length > 0,
      tab: 'skills',
    },
    {
      id: 'production',
      label: 'Студия или «фрилансер»',
      weight: 5,
      ok: !!p.production_id || !!p.is_freelance,
      tab: 'basic',
    },
    {
      id: 'rate',
      label: 'Цена услуг',
      weight: 5,
      ok: (p.rate_min ?? 0) > 0 || (p.rate_max ?? 0) > 0,
      tab: 'basic',
    },
    {
      id: 'username',
      label: 'Короткий URL (username)',
      weight: 5,
      ok: !!p.username?.trim(),
      tab: 'publish',
    },
    {
      id: 'portfolio_1',
      label: 'Минимум одна работа',
      weight: 15,
      ok: portfolio.length >= 1,
      tab: 'portfolio',
    },
    {
      id: 'portfolio_3',
      label: '3+ работы (попадание в топ)',
      weight: 15,
      ok: portfolio.length >= 3,
      tab: 'portfolio',
    },
    {
      id: 'social',
      label: 'Хотя бы одна соцсеть для контакта',
      weight: 10,
      ok: anySocial,
      tab: 'contacts',
    },
    {
      id: 'contact',
      label: 'Email или телефон',
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
