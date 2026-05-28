export interface Category {
  code: string;
  title: string;
  description: string;
  type: string;
  icon?: string;
  sort_order: number;
}

export interface CategoryStat {
  code: string;
  count: number;
}

export interface Skill {
  id: string;
  slug: string;
  title: string;
  kind: 'tool' | 'platform' | 'genre' | string;
}
