import {
  formatRate,
  formatPublicRate,
  formatDuration,
  pluralCategories,
  pluralSpecialists,
} from '@shared/lib/format';

describe('formatRate', () => {
  it('диапазон min–max возвращает диапазон с символом валюты', () => {
    expect(formatRate(1000, 5000)).toBe('1 000–5 000 ₽');
  });

  it('равные min и max — не диапазон, а одно значение через «от»', () => {
    expect(formatRate(3000, 3000)).toBe('от 3 000 ₽');
  });

  it('только min → «от N»', () => {
    expect(formatRate(2500)).toBe('от 2 500 ₽');
  });

  it('только max → «до N»', () => {
    expect(formatRate(undefined, 9000)).toBe('до 9 000 ₽');
  });

  it('оба пустые → "по договорённости"', () => {
    expect(formatRate(null, null)).toBe('по договорённости');
    expect(formatRate(undefined, undefined)).toBe('по договорённости');
  });

  it('кастомная валюта — без знака рубля', () => {
    expect(formatRate(100, 200, 'USD')).toBe('100–200 USD');
  });
});

describe('formatPublicRate', () => {
  it('вменяемая вилка показывается диапазоном', () => {
    expect(formatPublicRate(50000, 150000)).toBe('50\u00a0000–150\u00a0000 ₽');
  });

  // «100 000 – 100 000 000 ₽» клиенту ничего не сообщает, кроме того что
  // специалист не понял, что вписать. Схлопываем до нижней границы.
  it('абсурдно широкая вилка схлопывается до «от N»', () => {
    expect(formatPublicRate(100000, 100000000)).toBe('от 100\u00a0000 ₽');
  });

  it('нули считаются «не указано» — никаких «от 0»', () => {
    expect(formatPublicRate(0, 0)).toBe('по договорённости');
    expect(formatPublicRate(0, 50000)).toBe('до 50\u00a0000 ₽');
    expect(formatPublicRate(50000, 0)).toBe('от 50\u00a0000 ₽');
  });

  it('равные границы — не диапазон', () => {
    expect(formatPublicRate(30000, 30000)).toBe('от 30\u00a0000 ₽');
  });

  it('ничего не задано → по договорённости', () => {
    expect(formatPublicRate(null, null)).toBe('по договорённости');
    expect(formatPublicRate(undefined, undefined)).toBe('по договорённости');
  });

  it('кастомная валюта', () => {
    expect(formatPublicRate(100, 200, 'USD')).toBe('100–200 USD');
  });
});

describe('formatDuration', () => {
  it('секунды форматируются как m:ss', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(605)).toBe('10:05');
  });

  it('меньше минуты — 0:ss', () => {
    expect(formatDuration(7)).toBe('0:07');
  });

  it('null / 0 / negative — пусто', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(-5)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });
});

describe('pluralCategories', () => {
  it('1 → категория, 2-4 → категории, 5+ → категорий', () => {
    expect(pluralCategories(1)).toBe('категория');
    expect(pluralCategories(2)).toBe('категории');
    expect(pluralCategories(4)).toBe('категории');
    expect(pluralCategories(5)).toBe('категорий');
    expect(pluralCategories(10)).toBe('категорий');
  });

  it('11-14 → категорий (исключение)', () => {
    expect(pluralCategories(11)).toBe('категорий');
    expect(pluralCategories(14)).toBe('категорий');
  });

  it('21, 22, 25 — учитывают последнюю цифру', () => {
    expect(pluralCategories(21)).toBe('категория');
    expect(pluralCategories(22)).toBe('категории');
    expect(pluralCategories(25)).toBe('категорий');
  });

  it('0 → категорий', () => {
    expect(pluralCategories(0)).toBe('категорий');
  });
});

describe('pluralSpecialists', () => {
  it('форматирует «N специалист(а|ов)»', () => {
    expect(pluralSpecialists(1)).toBe('1 специалист');
    expect(pluralSpecialists(3)).toBe('3 специалиста');
    expect(pluralSpecialists(5)).toBe('5 специалистов');
    expect(pluralSpecialists(11)).toBe('11 специалистов');
    expect(pluralSpecialists(21)).toBe('21 специалист');
  });
});
