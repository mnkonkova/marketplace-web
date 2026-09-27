import {
  initData,
  initTelegramApp,
  isTelegramWebApp,
  tgHaptic,
  tgHapticResult,
  tgHapticSelection,
} from '@shared/lib/telegram-webapp';
import { safeInternalPath } from '@pages/tg/tg-entry.page';

/**
 * Опознание мини-аппа и тактильный отклик.
 *
 * Ломается это тихо в обе стороны. Если считать мини-аппом любой
 * браузер, где подключился скрипт Telegram, человек в обычном хроме
 * увидит экран, который ждёт подписи и не дождётся. Если вибрация
 * кинет исключение на старом клиенте — упадёт обработчик нажатия, то
 * есть кнопка перестанет работать вовсе.
 */
describe('telegram-webapp', () => {
  const g = window as unknown as { Telegram?: unknown };

  afterEach(() => {
    delete g.Telegram;
    history.replaceState(null, '', window.location.pathname);
  });

  it('обычный браузер — не мини-апп', () => {
    expect(isTelegramWebApp()).toBeFalse();
    expect(initData()).toBe('');
  });

  it('подключённый скрипт без initData — тоже не мини-апп', () => {
    // Скрипт telegram-web-app.js подключается и в обычном браузере:
    // объект есть, подписи нет. Считать это мини-аппом значит
    // показать человеку экран, который ждёт того, чего не будет.
    g.Telegram = { WebApp: { initData: '' } };
    expect(isTelegramWebApp()).toBeFalse();
  });

  it('initData из Telegram отдаётся сырой', () => {
    const raw = 'user=%7B%22id%22%3A1%7D&hash=abc';
    g.Telegram = { WebApp: { initData: raw } };
    expect(isTelegramWebApp()).toBeTrue();
    // Именно посимвольно: любая пересборка ломает подпись, и сервер
    // отличит это от подделки только тем, что она не сойдётся.
    expect(initData()).toBe(raw);
  });

  it('строка, снятая до старта приложения, важнее объекта Telegram', () => {
    // Роутер переписывает адрес на первой навигации и перекодирует
    // фрагмент; асинхронный скрипт Telegram успевает прочитать уже
    // испорченную строку. Целая — та, что снята в index.html.
    const w = window as unknown as { __tgInitData?: string };
    w.__tgInitData = 'user=%7B%22id%22%3A1%7D&hash=real';
    g.Telegram = { WebApp: { initData: 'user=%257B%2522id%2522%253A1%257D&hash=broken' } };
    expect(initData()).toBe('user=%7B%22id%22%3A1%7D&hash=real');
    delete w.__tgInitData;
  });

  it('dev_init_data работает только как подстановка для стенда', () => {
    history.replaceState(null, '', `${window.location.pathname}?dev_init_data=user%3D1%26hash%3Dz`);
    expect(initData()).toBe('user=1&hash=z');
    expect(isTelegramWebApp()).toBeTrue();
  });

  it('вибрация вне мини-аппа молчит и не кидает', () => {
    expect(() => {
      tgHaptic('light');
      tgHaptic('medium');
      tgHapticResult(true);
      tgHapticSelection();
    }).not.toThrow();
  });

  it('вибрация зовётся, когда мы внутри', () => {
    const impact = jasmine.createSpy('impactOccurred');
    const notification = jasmine.createSpy('notificationOccurred');
    const selection = jasmine.createSpy('selectionChanged');
    g.Telegram = {
      WebApp: {
        initData: 'user=1&hash=z',
        HapticFeedback: {
          impactOccurred: impact,
          notificationOccurred: notification,
          selectionChanged: selection,
        },
      },
    };
    tgHaptic('medium');
    tgHapticResult(false);
    tgHapticSelection();
    expect(impact).toHaveBeenCalledWith('medium');
    expect(notification).toHaveBeenCalledWith('error');
    expect(selection).toHaveBeenCalled();
  });

  it('старый клиент, который кидает на вибрации, не роняет нажатие', () => {
    g.Telegram = {
      WebApp: {
        initData: 'user=1&hash=z',
        HapticFeedback: {
          impactOccurred: () => {
            throw new Error('unsupported version');
          },
        },
      },
    };
    // Если это исключение выйдет наружу, упадёт обработчик клика —
    // кнопка просто перестанет работать, и виноватой будет выглядеть она.
    expect(() => tgHaptic('light')).not.toThrow();
    expect(() => tgHapticResult(true)).not.toThrow();
  });
});

/**
 * Запуск внутри мини-аппа: шапка, вибрация и кнопка «назад».
 *
 * Всё это — свойства ВСЕГО приложения, а не страницы входа, и
 * ошибиться здесь можно тихо: вне Telegram включённый режим прячет
 * человеку шапку сайта, а внутри выключенный оставляет два меню друг
 * на друге и кнопку «назад», которая никуда не ведёт.
 */
describe('initTelegramApp', () => {
  const g = window as unknown as { Telegram?: unknown };

  afterEach(() => {
    delete g.Telegram;
    document.body.classList.remove('tg-app');
  });

  function fakeWebApp(withBack = true) {
    const back = {
      show: jasmine.createSpy('show'),
      hide: jasmine.createSpy('hide'),
      onClick: jasmine.createSpy('onClick'),
    };
    g.Telegram = {
      WebApp: {
        initData: 'user=1&hash=z',
        ready: jasmine.createSpy('ready'),
        expand: jasmine.createSpy('expand'),
        HapticFeedback: {
          impactOccurred: jasmine.createSpy('impact'),
          selectionChanged: jasmine.createSpy('selection'),
        },
        ...(withBack ? { BackButton: back } : {}),
      },
    };
    return back;
  }

  it('вне Telegram не делает ничего', () => {
    const sync = initTelegramApp(() => undefined);
    sync('/me/projects/123');
    expect(document.body.classList.contains('tg-app')).toBeFalse();
  });

  it('внутри — разворачивает окно и помечает body', () => {
    fakeWebApp();
    initTelegramApp(() => undefined);
    expect(document.body.classList.contains('tg-app')).toBeTrue();
  });

  it('кнопка «назад» прячется на корнях кабинета и появляется глубже', () => {
    const back = fakeWebApp();
    const sync = initTelegramApp(() => undefined);

    sync('/me/creator/projects');
    expect(back.hide).toHaveBeenCalled();

    sync('/me/creator/projects/7f0d8d0e');
    expect(back.show).toHaveBeenCalled();

    // Адрес с параметрами — тот же экран: «?tab=money» не делает
    // корень не корнем.
    back.hide.calls.reset();
    sync('/me/projects?from_page=/x');
    expect(back.hide).toHaveBeenCalled();
  });

  it('старый клиент без BackButton не роняет запуск', () => {
    fakeWebApp(false);
    expect(() => initTelegramApp(() => undefined)('/me/projects/1')).not.toThrow();
    expect(document.body.classList.contains('tg-app')).toBeTrue();
  });

  it('нажатие отзывается вибрацией, переключение — своей', () => {
    fakeWebApp();
    initTelegramApp(() => undefined);
    const tg = (g.Telegram as { WebApp: { HapticFeedback: Record<string, jasmine.Spy> } }).WebApp
      .HapticFeedback;

    const btn = document.createElement('button');
    btn.className = 'btn primary';
    document.body.appendChild(btn);
    btn.click();
    // Действие, меняющее мир, отзывается заметнее обычного нажатия.
    expect(tg['impactOccurred']).toHaveBeenCalledWith('medium');

    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    document.body.appendChild(tab);
    tab.click();
    expect(tg['selectionChanged']).toHaveBeenCalled();

    btn.remove();
    tab.remove();
  });
});

/**
 * Куда ведёт кнопка «Открыть» из сообщения бота.
 *
 * Адрес приходит из сообщения, то есть снаружи, и принимать его как
 * есть нельзя: `/tg?to=https://чужой.сайт` увёл бы человека вместе с
 * нашей сессией.
 */
describe('safeInternalPath', () => {
  it('принимает пути кабинета', () => {
    expect(safeInternalPath('/me/creator/projects/7f0d8d0e')).toBeTrue();
    expect(safeInternalPath('/me/projects')).toBeTrue();
    expect(safeInternalPath('/me/creator/invitations')).toBeTrue();
    expect(safeInternalPath('/admin')).toBeTrue();
    expect(safeInternalPath('/manager/projects/1')).toBeTrue();
  });

  it('отвергает чужое и подозрительное', () => {
    expect(safeInternalPath('https://evil.example/me')).toBeFalse();
    // Протокол-относительный адрес: браузер уведёт на чужой хост.
    expect(safeInternalPath('//evil.example/me')).toBeFalse();
    expect(safeInternalPath('/feed')).toBeFalse();
    expect(safeInternalPath('/me/../../x')).toBeFalse();
    expect(safeInternalPath('/me/projects\nSet-Cookie: x')).toBeFalse();
    expect(safeInternalPath('')).toBeFalse();
  });
});
