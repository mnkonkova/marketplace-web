export function formatRate(min?: number | null, max?: number | null, currency = 'RUB'): string {
  const sym = currency === 'RUB' ? '₽' : currency;
  if (min != null && max != null && min !== max) {
    return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} ${sym}`;
  }
  if (min != null) return `от ${min.toLocaleString('ru-RU')} ${sym}`;
  if (max != null) return `до ${max.toLocaleString('ru-RU')} ${sym}`;
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
