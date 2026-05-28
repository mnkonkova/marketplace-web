export interface ApiErrorFieldDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  details?: ApiErrorFieldDetail[];
}

export function apiErrorMessage(body: ApiErrorBody | null, fallback = 'Ошибка запроса'): string {
  if (!body) return fallback;

  const code = body.error;
  const map: Record<string, string> = {
    bad_json: 'Некорректные данные',
    user_exists: 'Пользователь уже существует',
    invalid_credentials: 'Неверный логин или пароль',
    not_found: 'Не найдено',
    search_unavailable: 'Поиск временно недоступен',
    feed_failed: 'Не удалось загрузить ленту',
  };

  const head = body.message?.trim() || (code && map[code]) || code || fallback;

  if (body.details?.length) {
    const fields = body.details
      .map((d) => `${d.field}: ${d.message}`)
      .filter((s) => s.trim().length > 0)
      .join('; ');
    if (fields) return `${head}. ${fields}`;
  }

  return head;
}
