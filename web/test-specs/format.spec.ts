import {
  formatAgo,
  formatRate,
  formatPublicRate,
  formatDuration,
  plural,
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

/**
 * Плюрализация счётчиков.
 *
 * На экранах проекта числа подставлялись к слову в одной форме: «1
 * выкладок», «по 1 роликам», «1 роликов закрыто». Это не опечатки, а
 * отсутствие правила, поэтому правило одно на всё приложение и проверяется
 * здесь, а не в каждом виджете по отдельности.
 */
describe('plural', () => {
  it('1, 2, 5 — три разные формы', () => {
    expect(plural(1, 'ролик', 'ролика', 'роликов')).toBe('ролик');
    expect(plural(2, 'ролик', 'ролика', 'роликов')).toBe('ролика');
    expect(plural(5, 'ролик', 'ролика', 'роликов')).toBe('роликов');
  });

  it('11–14 — всегда третья форма, несмотря на последнюю цифру', () => {
    expect(plural(11, 'выкладка', 'выкладки', 'выкладок')).toBe('выкладок');
    expect(plural(12, 'выкладка', 'выкладки', 'выкладок')).toBe('выкладок');
    expect(plural(14, 'выкладка', 'выкладки', 'выкладок')).toBe('выкладок');
  });

  it('за сотней правило то же: 101, 102, 111', () => {
    expect(plural(101, 'ссылка', 'ссылки', 'ссылок')).toBe('ссылка');
    expect(plural(102, 'ссылка', 'ссылки', 'ссылок')).toBe('ссылки');
    expect(plural(111, 'ссылка', 'ссылки', 'ссылок')).toBe('ссылок');
  });

  it('ноль — третья форма: «0 роликов», а не «0 ролик»', () => {
    expect(plural(0, 'ролик', 'ролика', 'роликов')).toBe('роликов');
  });

  it('отрицательные считаются по модулю — так живёт «−1 день»', () => {
    expect(plural(-1, 'день', 'дня', 'дней')).toBe('день');
    expect(plural(-3, 'день', 'дня', 'дней')).toBe('дня');
  });

  // Круглые числа — отдельная дыра правила: у 100 и 1000 последняя цифра
  // ноль, у 21 и 101 — единица, и «21 проектов» ловится только здесь.
  it('круглые и близкие к ним: 20, 21, 100, 1000', () => {
    expect(plural(20, 'проект', 'проекта', 'проектов')).toBe('проектов');
    expect(plural(21, 'проект', 'проекта', 'проектов')).toBe('проект');
    expect(plural(22, 'проект', 'проекта', 'проектов')).toBe('проекта');
    expect(plural(100, 'проект', 'проекта', 'проектов')).toBe('проектов');
    expect(plural(1000, 'проект', 'проекта', 'проектов')).toBe('проектов');
    expect(plural(1001, 'проект', 'проекта', 'проектов')).toBe('проект');
  });

  // Сдвиг срока приходит дробным («на 1.5 дня»), и форма считается по
  // целой части: иначе Math.abs(1.5) % 10 давал бы не ту ветку.
  it('дробные считаются по целой части', () => {
    expect(plural(1.4, 'день', 'дня', 'дней')).toBe('день');
    expect(plural(2.9, 'день', 'дня', 'дней')).toBe('дня');
    expect(plural(-2.5, 'день', 'дня', 'дней')).toBe('дня');
  });
});

describe('formatAgo', () => {
  // Точка отсчёта фиксированная: иначе «три дня назад» зависит от того,
  // в какую секунду запустился тест.
  const now = new Date('2026-09-14T12:00:00Z').getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('меньше минуты — «только что»', () => {
    expect(formatAgo(ago(20_000), now)).toBe('только что');
  });

  it('минуты и часы', () => {
    expect(formatAgo(ago(5 * MIN), now)).toBe('5 мин назад');
    expect(formatAgo(ago(3 * HOUR), now)).toBe('3 ч назад');
  });

  // Ради этого случая колонка и заведена: «что не двигалось неделю».
  it('дни — с правильной формой слова', () => {
    expect(formatAgo(ago(DAY), now)).toBe('1 день назад');
    expect(formatAgo(ago(3 * DAY), now)).toBe('3 дня назад');
    expect(formatAgo(ago(7 * DAY), now)).toBe('7 дней назад');
    expect(formatAgo(ago(11 * DAY), now)).toBe('11 дней назад');
    expect(formatAgo(ago(21 * DAY), now)).toBe('21 день назад');
  });

  it('дальше двух месяцев считает месяцами', () => {
    expect(formatAgo(ago(90 * DAY), now)).toBe('3 месяца назад');
  });

  it('часы браузера впереди серверных — «только что», а не «через»', () => {
    expect(formatAgo(new Date(now + 5 * MIN).toISOString(), now)).toBe('только что');
  });

  it('мусор вместо даты — пустая строка, а не NaN', () => {
    expect(formatAgo('не дата', now)).toBe('');
  });
});
