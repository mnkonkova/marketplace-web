export function formatRate(min?: number | null, max?: number | null, currency = 'RUB'): string {
  const sym = currency === 'RUB' ? '₽' : currency;
  if (min != null && max != null && min !== max) {
    return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} ${sym}`;
  }
  if (min != null) return `от ${min.toLocaleString('ru-RU')} ${sym}`;
  if (max != null) return `до ${max.toLocaleString('ru-RU')} ${sym}`;
  return 'по договорённости';
}

/**
 * Максимальная кратность max/min, при которой диапазон ещё что-то сообщает.
 * «100 000 – 100 000 000 ₽» — это не вилка, а «я не понял, что вписать»:
 * клиенту такой диапазон не помогает, а доверие роняет.
 */
const SANE_RATE_SPREAD = 10;

/**
 * Цена для публичной страницы специалиста. В отличие от formatRate:
 *   • нули считаются «не указано» (иначе выходит «от 0 ₽»);
 *   • абсурдно широкая вилка схлопывается до нижней границы.
 * В карточках поиска остаётся formatRate — там строка короче и правится
 * фильтром, менять её поведение из-за одной страницы нельзя.
 */
export function formatPublicRate(
  min?: number | null,
  max?: number | null,
  currency = 'RUB',
): string {
  const sym = currency === 'RUB' ? '₽' : currency;
  const lo = min != null && min > 0 ? min : null;
  const hi = max != null && max > 0 ? max : null;

  if (lo != null && hi != null && hi > lo) {
    if (hi / lo > SANE_RATE_SPREAD) return `от ${lo.toLocaleString('ru-RU')} ${sym}`;
    return `${lo.toLocaleString('ru-RU')}–${hi.toLocaleString('ru-RU')} ${sym}`;
  }
  if (lo != null) return `от ${lo.toLocaleString('ru-RU')} ${sym}`;
  if (hi != null) return `до ${hi.toLocaleString('ru-RU')} ${sym}`;
  return 'по договорённости';
}

export function formatDuration(sec?: number | null): string {
  if (sec == null || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function pluralCategories(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'категория';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'категории';
  return 'категорий';
}

export function pluralSpecialists(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} специалист`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} специалиста`;
  return `${n} специалистов`;
}
