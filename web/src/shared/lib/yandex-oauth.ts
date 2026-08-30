import { environment } from '../../environments/environment';

/**
 * Уход на страницу авторизации Яндекса.
 *
 * redirect_uri зарегистрирован в кабинете Яндекса и должен совпадать с ним
 * посимвольно — иначе обмен кода вернёт invalid_grant. Возвращаемся на
 * корень сайта: путь до нужного экрана храним отдельно и восстанавливаем
 * после возврата.
 *
 * `state` — защита от подмены: кладём в sessionStorage и сверяем на возврате.
 * Через него же передаём роль и страницу, куда человек шёл.
 */
export interface YandexState {
  kind: 'client' | 'specialist';
  /** Куда вернуть человека после входа. */
  back: string;
}

const KEY = 'marketpclce.yandex.state';

export function yandexEnabled(): boolean {
  return !!environment.yandexClientId;
}

export function startYandexLogin(state: YandexState): void {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem(KEY, JSON.stringify({ nonce, ...state }));

  const url = new URL('https://oauth.yandex.ru/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', environment.yandexClientId);
  url.searchParams.set('redirect_uri', environment.yandexRedirectUri);
  url.searchParams.set('state', nonce);
  window.location.href = url.toString();
}

/**
 * Разбирает возврат от Яндекса. Возвращает null, если это обычный заход —
 * тогда вызывающий ничего не делает.
 */
export function readYandexReturn(search: string): (YandexState & { code: string }) | null {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const nonce = params.get('state');
  if (!code || !nonce) return null;

  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw) as YandexState & { nonce: string };
    // Не наш state — код пришёл не из нашего перехода, игнорируем.
    if (saved.nonce !== nonce) return null;
    return { code, kind: saved.kind, back: saved.back };
  } catch {
    return null;
  }
}
