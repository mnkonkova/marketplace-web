import { Category } from '@entities/category/model/category.types';

export interface CategoryTypeGroup {
  type: string;
  sectionId: string;
  kicker?: string;
  categories: Category[];
}

/** Порядок секций на главной (неизвестные типы — в конце по алфавиту). */
export const CATEGORY_TYPE_ORDER = ['Производство', 'Продвижение'];

export const CATEGORY_TYPE_KICKERS: Record<string, string> = {
  Производство: 'контент-команды',
  Продвижение: 'медиа и реклама',
};

export function categoryTypeSectionId(type: string): string {
  const known: Record<string, string> = {
    Производство: 'production',
    Продвижение: 'promotion',
  };
  return known[type] ?? type.trim().toLowerCase().replace(/\s+/g, '-');
}

export function groupCategoriesByType(categories: Category[]): CategoryTypeGroup[] {
  const byType = new Map<string, Category[]>();
  for (const c of categories) {
    const t = c.type?.trim() || 'Прочее';
    const list = byType.get(t) ?? [];
    list.push(c);
    byType.set(t, list);
  }

  const sortCats = (arr: Category[]) =>
    [...arr].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ru'));

  const types = [...byType.keys()].sort((a, b) => {
    const ai = CATEGORY_TYPE_ORDER.indexOf(a);
    const bi = CATEGORY_TYPE_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'ru');
  });

  return types.map((type) => ({
    type,
    sectionId: categoryTypeSectionId(type),
    kicker: CATEGORY_TYPE_KICKERS[type],
    categories: sortCats(byType.get(type)!),
  }));
}

export const SHORT_TITLES: Record<string, string> = {
  video_director: 'Видеорежиссёр',
};

export function tileTitle(cat: { code: string; title: string }): string {
  return SHORT_TITLES[cat.code] ?? cat.title;
}

export const CATEGORY_ICONS: Record<string, string> = {
  editor: '🎬',
  director: '🎬',
  video_director: '🎞️',
  motion: '✨',
  scriptwriter: '✍️',
  ugc: '📸',
  videographer: '🎥',
  photographer: '📷',
  actor: '🎭',
  designer: '🎨',
  ai_creator: '🤖',
  smm: '📱',
  blogger: '🌟',
  ads_seo: '🎯',
  seeding: '🌱',
};

export const HERO_QUICK_TAGS = [
  'ИИ-креатор',
  'Монтажёр для Reels',
  'Режиссёр',
  'SMM для бренда',
  'UGC-креатор',
  'Таргетолог',
  'Сценарист',
];
