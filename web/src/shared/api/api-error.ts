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
    // 401 — токен отсутствует/протух/невалидный/отозван.
    missing_bearer: 'Сессия истекла — войдите снова',
    invalid_token: 'Сессия истекла — войдите снова',
    no_user: 'Сессия истекла — войдите снова',
    // 403 — auth прошёл, но не хватает чего-то на стороне профиля.
    email_unverified: 'Подтвердите email, чтобы продолжить (ссылка на ящик)',
    forbidden_unapproved: 'Аккаунт ожидает одобрения админом',
    forbidden_role: 'Недостаточно прав',
    inactive: 'Аккаунт деактивирован',
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

// ---- разбор HttpErrorResponse ----

export interface ParsedApiError {
  // Машинный код из поля `error`. Пустая строка, если тела нет.
  code: string;
  // Готовый текст для пользователя. Бэк присылает его в `message`
  // по-русски — свой текст сочиняем только когда message пуст.
  message: string;
  status: number;
}

interface HttpErrorLike {
  status?: number;
  error?: ApiErrorBody | string | null;
}

// parseApiError — единая распаковка ошибки ручки. Ручки CRM отдают
// {error, message}: `message` уже написан для пользователя, поэтому он
// имеет приоритет над любыми фронтовыми формулировками. fallback уходит
// в дело только когда message пуст — например у httpx.WriteErr без текста.
export function parseApiError(
  e: unknown,
  fallback = 'Не удалось выполнить запрос',
): ParsedApiError {
  const err = (e ?? {}) as HttpErrorLike;
  const status = typeof err.status === 'number' ? err.status : 0;
  const body: ApiErrorBody | null =
    err.error && typeof err.error === 'object' ? (err.error as ApiErrorBody) : null;
  const code = body?.error?.trim() || '';
  const message = body?.message?.trim() || apiErrorMessage(body, fallback);
  return { code, message, status };
}
