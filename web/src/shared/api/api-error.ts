export interface ApiErrorBody {
  error?: string;
}

export function apiErrorMessage(body: ApiErrorBody | null, fallback = 'Ошибка запроса'): string {
  const code = body?.error;
  const map: Record<string, string> = {
    bad_json: 'Некорректные данные',
    user_exists: 'Пользователь уже существует',
    invalid_credentials: 'Неверный логин или пароль',
    not_found: 'Не найдено',
    search_unavailable: 'Поиск временно недоступен',
    feed_failed: 'Не удалось загрузить ленту',
  };
  return (code && map[code]) || code || fallback;
}
