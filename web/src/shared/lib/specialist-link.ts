import { environment } from '../../environments/environment';

// specialistHandle — возвращает username если задан, иначе user_id.
// Используется во всех navigate(['/specialist', handle]) — это даёт
// красивый URL /specialist/foxy там где спец выбрал handle, и fallback
// на UUID для тех у кого ещё не выбрано.
export function specialistHandle(spec: { username?: string; user_id: string }): string {
  return spec.username && spec.username.length > 0 ? spec.username : spec.user_id;
}

/**
 * Публичный адрес для «Поделиться»: QR, копирование, ссылка-визитка.
 *
 * Если задан environment.shareBaseUrl — отдаём ссылку через воркер превью
 * (см. комментарий в environments/environment.ts): краулер Telegram не
 * достаёт наш VDS напрямую, и без воркера ссылка разворачивается пустой
 * карточкой. Иначе — обычный адрес текущего домена.
 *
 * Держим в одном месте: карточка «Поделиться» строила URL сама, из-за чего
 * копировалась ссылка на wayprmarket.ru, а визитка на странице специалиста —
 * уже через воркер. Два разных адреса на одну и ту же страницу.
 */
export function publicShareUrl(handle: string): string {
  const base = environment.shareBaseUrl?.replace(/\/+$/, '');
  if (base) return `${base}/s/${handle}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/specialist/${handle}`;
}
