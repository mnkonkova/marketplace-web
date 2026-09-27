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
  // Кнопка «назад» в шапке самого Telegram. Своей у мини-аппа нет, а
  // жест «назад» в webview работает не везде: без неё человек уходит
  // вглубь и выбирается закрытием окна.
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (cb: () => void) => void;
    offClick?: (cb: () => void) => void;
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
 * Загрузить скрипт Telegram, если его почему-то нет.
 *
 * Обычно он уже подключён из index.html: мини-апп — это не одна
 * страница входа, а весь кабинет, и вибрация, разворот на весь лист и
 * кнопка «назад» нужны на каждом экране. Скрипт крошечный, отдаётся с
 * CDN Telegram и кешируется всеми, кто хоть раз открывал любой
 * мини-апп.
 *
 * Функция остаётся на случай, когда index.html не успел (или запрос к
 * telegram.org не прошёл): экран входа без неё показал бы «это вход из
 * Telegram» человеку, который как раз из Telegram и пришёл.
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

// ── запуск внутри мини-аппа ────────────────────────────────────────

/** Экраны, с которых «назад» некуда: это корни кабинетов. */
const ROOT_SCREENS = ['/me/projects', '/me/creator/projects', '/admin', '/tg'];

/**
 * Подготовить приложение к жизни внутри Telegram.
 *
 * Зовётся один раз при старте. Вне мини-аппа не делает ничего — и это
 * важнее, чем кажется: те же экраны открывают в обычном браузере, и
 * ветвиться на каждом из них значит однажды забыть.
 *
 * Что делает:
 *   • говорит Telegram, что экран готов, и разворачивает окно;
 *   • вешает на <body> класс tg-app — по нему прячется шапка сайта:
 *     внутри Telegram своё меню сверху, и второе поверх него читается
 *     как чужая страница;
 *   • включает тактильный отклик на нажатия — централизованно, а не
 *     на каждой кнопке;
 *   • показывает кнопку «назад» Telegram везде, кроме корней.
 */
export function initTelegramApp(onBack: () => void): (url: string) => void {
  if (!isTelegramWebApp()) return () => undefined;
  tgReady();
  document.body.classList.add('tg-app');
  installTapHaptics();
  return installBackButton(onBack);
}

/**
 * Отклик на нажатие — одним слушателем на документ.
 *
 * Не директивой на каждой кнопке: кнопок сотни, новая появляется
 * каждую неделю, и та, о которой забыли, молча отличается от
 * соседних. Слушатель ловит всплытие и сам решает, что было нажато.
 */
function installTapHaptics(): void {
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('button, a, [role="tab"], .c, .dc');
      if (!el) return;
      // Вкладки и клетки плана — «переключение», у него свой,
      // более тихий отклик.
      const selection = el.matches('[role="tab"], .ptabs button, .dc, .c');
      if (selection) {
        tgHapticSelection();
        return;
      }
      // Действия, меняющие мир, отзываются заметнее обычных: по
      // ним человек понимает, что нажал не «посмотреть».
      const strong = el.matches('.btn.primary, .btn.danger, [type="submit"]');
      tgHaptic(strong ? 'medium' : 'light');
    },
    // Перехватываем на всплытии и пассивно: отклик не должен ни
    // задерживать обработчик кнопки, ни мешать прокрутке.
    { passive: true },
  );
}

/**
 * Кнопка «назад» Telegram. Возвращает функцию «пересчитать по адресу»
 * — её зовут на каждую навигацию.
 *
 * Возвращаем, а не храним в модуле: экспортируемая переменная,
 * которую кто-то переприсваивает, — это скрытое состояние, и в
 * тестах она живёт между прогонами.
 */
function installBackButton(onBack: () => void): (url: string) => void {
  const btn = webApp()?.BackButton;
  if (!btn) return () => undefined;
  try {
    btn.onClick?.(onBack);
  } catch {
    return () => undefined;
  }
  return (url: string) => {
    const path = (url || '/').split('?')[0];
    const root = ROOT_SCREENS.some((r) => path === r || path === r + '/');
    try {
      if (root) btn.hide?.();
      else btn.show?.();
    } catch {
      /* старый клиент — молча */
    }
  };
}
