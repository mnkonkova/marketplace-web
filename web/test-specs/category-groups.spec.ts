import { Category } from '@entities/category/model/category.types';

import {
  CATEGORY_TYPE_ORDER,
  categoryTypeSectionId,
  groupCategoriesByType,
  tileTitle,
  SHORT_TITLES,
} from './category-groups';

function cat(code: string, title: string, type: string, sort_order = 0): Category {
  return { code, title, description: '', type, sort_order } as Category;
}

describe('categoryTypeSectionId', () => {
  it('известные русские типы → стабильный latin slug', () => {
    expect(categoryTypeSectionId('Производство')).toBe('production');
    expect(categoryTypeSectionId('Продвижение')).toBe('promotion');
  });

  it('неизвестный тип — fallback на lowercase + dash', () => {
    expect(categoryTypeSectionId('Что-то Новое')).toBe('что-то-новое');
    expect(categoryTypeSectionId('  С  пробелами  ')).toBe('с-пробелами');
  });
});

describe('groupCategoriesByType', () => {
  it('известные типы идут в порядке CATEGORY_TYPE_ORDER, прочие — за ними по алфавиту', () => {
    const cats: Category[] = [
      cat('a', 'A', 'Прочее'),
      cat('b', 'B', 'Продвижение'),
      cat('c', 'C', 'Производство'),
      cat('d', 'D', 'Аналитика'),
    ];
    const groups = groupCategoriesByType(cats);
    expect(groups.map((g) => g.type)).toEqual([
      'Производство', // ord 0
      'Продвижение',  // ord 1
      'Аналитика',    // unknown, по алфавиту
      'Прочее',
    ]);
  });

  it('категории внутри типа сортируются по sort_order, потом по title', () => {
    const cats: Category[] = [
      cat('b', 'B', 'Производство', 2),
      cat('a', 'A', 'Производство', 2),
      cat('c', 'C', 'Производство', 1),
    ];
    const [prod] = groupCategoriesByType(cats);
    expect(prod.categories.map((c) => c.code)).toEqual(['c', 'a', 'b']);
  });

  it('пустой type → группа "Прочее"', () => {
    const cats: Category[] = [{ ...cat('x', 'X', ''), type: '' as string }];
    const groups = groupCategoriesByType(cats);
    expect(groups[0].type).toBe('Прочее');
  });

  it('известные типы получают kicker', () => {
    const groups = groupCategoriesByType([cat('a', 'A', 'Производство')]);
    expect(groups[0].kicker).toBe('контент-команды');
  });

  it('sectionId присваивается из categoryTypeSectionId', () => {
    const groups = groupCategoriesByType([cat('a', 'A', 'Продвижение')]);
    expect(groups[0].sectionId).toBe('promotion');
  });
});

describe('tileTitle', () => {
  it('возвращает SHORT_TITLES если есть, иначе исходный title', () => {
    expect(tileTitle({ code: 'video_director', title: 'Видео-режиссёр' })).toBe(
      SHORT_TITLES['video_director'],
    );
    expect(tileTitle({ code: 'unknown', title: 'My Title' })).toBe('My Title');
  });
});

describe('CATEGORY_TYPE_ORDER', () => {
  it('содержит ключи которые также есть в KICKERS', () => {
    expect(CATEGORY_TYPE_ORDER.length).toBeGreaterThan(0);
    expect(CATEGORY_TYPE_ORDER.every((t) => typeof t === 'string')).toBe(true);
  });
});
