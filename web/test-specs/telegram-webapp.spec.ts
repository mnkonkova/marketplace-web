import {
  initData,
  isTelegramWebApp,
  tgHaptic,
  tgHapticResult,
  tgHapticSelection,
} from '@shared/lib/telegram-webapp';

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
