import { formatPublicRate } from './format';

/**
 * Потолок «вменяемой» ставки. Всё, что выше, — почти всегда лишний ноль
 * (на публичной встречалось «100 000–100 000 000 ₽»). Блокируем сохранение,
 * а не молча подрезаем: цена — то, по чему клиент решает писать или нет.
 */
export const MAX_REASONABLE_RATE = 10_000_000;

export interface RateValidation {
  /** Сообщение, блокирующее сохранение. null — можно сохранять. */
  error: string | null;
  /** Мягкая подсказка: сохранить можно, но клиент увидит не то, что ждут. */
  warning: string | null;
  /** Нормализованная нижняя граница: 0/пусто/мусор → null. */
  min: number | null;
  /** Нормализованная верхняя граница: 0/пусто/мусор → null. */
  max: number | null;
  /** Ровно та строка, которую увидит клиент на публичной странице. */
  preview: string;
}

/** Ноль и пустое — это «цена не указана», а не «работаю за 0 ₽». */
function normalize(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/**
 * Правила цены редактора профиля. Проверяем ДО отправки, потому что «от 0 ₽»
 * и вилка в тысячу раз — это не ошибка бэка, а то, что фронт разрешил ввести.
 */
export function validateRate(
  rawMin: number | null | undefined,
  rawMax: number | null | undefined,
  currency = 'RUB',
): RateValidation {
  const min = normalize(rawMin);
  const max = normalize(rawMax);
  const preview = formatPublicRate(min, max, currency);
  const base: RateValidation = { error: null, warning: null, min, max, preview };

  const negative =
    (rawMin != null && Number.isFinite(rawMin) && rawMin < 0) ||
    (rawMax != null && Number.isFinite(rawMax) && rawMax < 0);
  if (negative) {
    return { ...base, error: 'Ставка не может быть отрицательной.' };
  }

  const tooBig =
    (min != null && min > MAX_REASONABLE_RATE) || (max != null && max > MAX_REASONABLE_RATE);
  if (tooBig) {
    return {
      ...base,
      error: `Ставка выше ${MAX_REASONABLE_RATE.toLocaleString('ru-RU')} ₽ — похоже на лишний ноль. Проверьте число.`,
    };
  }

  if (min != null && max != null && min > max) {
    return { ...base, error: 'Ставка «от» больше, чем «до».' };
  }

  // Кратность «до»/«от» намеренно НЕ ограничиваем. Широкая вилка — обычное
  // дело: монтажёр берёт и правку за пять тысяч, и проект за сто. Лишний
  // ноль ловится потолком MAX_REASONABLE_RATE, а этого достаточно.

  const typedZero =
    (rawMin != null && Number.isFinite(rawMin) && rawMin === 0) ||
    (rawMax != null && Number.isFinite(rawMax) && rawMax === 0);
  if (typedZero) {
    return {
      ...base,
      warning: 'Ноль — это не цена. Оставьте поле пустым: клиент увидит «по договорённости».',
    };
  }

  if (min == null && max == null) {
    return {
      ...base,
      warning: 'Цена не указана — на странице будет «по договорённости».',
    };
  }

  return base;
}
