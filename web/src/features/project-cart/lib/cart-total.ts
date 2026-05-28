import { SpecialistLite } from '@entities/specialist/model/specialist.types';
import { pluralSpecialists } from '@shared/lib/format';
import { CartTotal } from '../model/cart.types';

export function computeCartTotal(cart: SpecialistLite[]): CartTotal {
  const buckets = new Map<string, { min: number; max: number }>();
  let unspecified = 0;

  for (const s of cart) {
    const min = s.rate_min;
    const max = s.rate_max;
    if (min == null && max == null) {
      unspecified++;
      continue;
    }
    const cur = s.currency || 'RUB';
    const lo = min != null ? min : max!;
    const hi = max != null ? max : min!;
    const b = buckets.get(cur) ?? { min: 0, max: 0 };
    b.min += lo;
    b.max += hi;
    buckets.set(cur, b);
  }

  if (buckets.size === 0) {
    return { label: 'по договорённости', note: '' };
  }

  const parts: string[] = [];
  for (const [cur, b] of buckets) {
    const sym = cur === 'RUB' ? '₽' : cur;
    parts.push(
      b.min === b.max
        ? `${b.min.toLocaleString('ru-RU')} ${sym}`
        : `${b.min.toLocaleString('ru-RU')}–${b.max.toLocaleString('ru-RU')} ${sym}`,
    );
  }

  let note = '';
  if (unspecified > 0) {
    note = `+ ${unspecified} ${pluralSpecialists(unspecified)} со ставкой по договорённости`;
  }

  return { label: parts.join(' + '), note };
}
