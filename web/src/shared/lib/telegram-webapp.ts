/**
 * Мини-апп Telegram: опознание среды и тактильный отклик.
 *
 * Всё здесь устроено как тихий no-op вне Telegram. Ветвиться на
 * стороне вызывающего («если мы в мини-аппе, то вибрируем») —
 * значит написать это условие в тридцати местах и в тридцать первом
 * забыть.
 */

/** Кусочек Telegram.WebApp, которым мы пользуемся. */
interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  colorScheme?: string;
  HapticFeedback?: {
    impactOccurred?: (style: string) => void;
    notificationOccurred?: (type: string) => void;
    selectionChanged?: () => void;
  };
}

function webApp(): TelegramWebApp | null {
  const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return tg ?? null;
}

/**
 * Мы внутри мини-аппа.
 *
 * Проверяем не только наличие объекта, но и initData: скрипт
 * telegram-web-app.js подключается и в обычном браузере (мы грузим его
 * на странице входа), и тогда Telegram.WebApp существует, но пустой.
 * Считать это мини-аппом значит показать человеку в браузере экран,
 * который ждёт подписи от Telegram.
 */
export function isTelegramWebApp(): boolean {
  return !!initData();
}

/**
 * Сырая строка подписи. Именно СЫРАЯ: любая пересборка — перекодировать,
 * отсортировать, убрать пустое — ломает подпись, и сервер отличит это
 * от подделки только тем, что она не сойдётся.
 *
 * `?dev_init_data=` — только для стенда: настоящий Telegram локальный
 * адрес не откроет, а проверять экран как-то надо. Подпись при этом
 * всё равно проверяет сервер, так что подставить сюда произвольную
 * строку и войти нельзя.
 */
export function initData(): string {
  const real = webApp()?.initData;
  if (real) return real;
  const dev = new URLSearchParams(window.location.search).get('dev_init_data');
  return dev ?? '';
}

/** Сказать Telegram, что экран готов, и развернуть его на весь лист. */
export function tgReady(): void {
  const tg = webApp();
  if (!tg) return;
  try {
    tg.ready?.();
    tg.expand?.();
  } catch {
    // Старые клиенты кидают на неподдерживаемых методах. Экран от
    // этого не должен падать: он и без разворота работает.
  }
}

/**
 * Загрузить скрипт Telegram один раз.
 *
 * Не в index.html: он нужен ровно на одной странице, а тянуть внешний
 * скрипт на каждый заход в каталог — лишний запрос всем, кто не из
 * Telegram.
 */
export function loadTelegramScript(): Promise<void> {
  const SRC = 'https://telegram.org/js/telegram-web-app.js';
  if (webApp()) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = SRC;
    el.async = true;
    // resolve в обоих случаях: не загрузился — значит человек не из
    // Telegram (или сеть), и экран обязан это пережить.
    el.onload = () => resolve();
    el.onerror = () => resolve();
    document.head.appendChild(el);
  });
}

// ── тактильный отклик ──────────────────────────────────────────────
//
// Нативные экраны Telegram отвечают на нажатие вибрацией, и кнопка без
// неё внутри Telegram читается как не нажавшаяся. Три проверки в
// каждом хелпере обязательны: мы в мини-аппе, объект HapticFeedback
// существует (в старых клиентах его нет), вызов обёрнут в try/catch
// (на неподдерживаемых версиях он кидает).
//
// Чего не делаем: вибрации на прокрутку, на появление экрана и на
// каждый введённый символ. Отклик на всё — это шум, от которого
// выключают телефон, а не продукт.

function haptics(): TelegramWebApp['HapticFeedback'] | null {
  if (!isTelegramWebApp()) return null;
  return webApp()?.HapticFeedback ?? null;
}

/** Обычное нажатие: 'light'. Действие, меняющее мир: 'medium'. */
export function tgHaptic(style: 'light' | 'medium' = 'light'): void {
  try {
    haptics()?.impactOccurred?.(style);
  } catch {
    /* старый клиент — молча */
  }
}

/** Ответ сервера. Зовётся рядом с тостом: вибрация и текст должны
 *  приходить вместе, иначе отклик читается как реакция на предыдущее
 *  действие. */
export function tgHapticResult(ok: boolean): void {
  try {
    haptics()?.notificationOccurred?.(ok ? 'success' : 'error');
  } catch {
    /* старый клиент — молча */
  }
}

/** Переключение вкладок и разделов. */
export function tgHapticSelection(): void {
  try {
    haptics()?.selectionChanged?.();
  } catch {
    /* старый клиент — молча */
  }
}
