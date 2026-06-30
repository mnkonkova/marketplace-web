// specialistHandle — возвращает username если задан, иначе user_id.
// Используется во всех navigate(['/specialist', handle]) — это даёт
// красивый URL /specialist/foxy там где спец выбрал handle, и fallback
// на UUID для тех у кого ещё не выбрано.
export function specialistHandle(spec: { username?: string; user_id: string }): string {
  return spec.username && spec.username.length > 0 ? spec.username : spec.user_id;
}
