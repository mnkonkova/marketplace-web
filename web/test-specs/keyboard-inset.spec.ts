import { trackKeyboardInset } from '@shared/lib/keyboard-inset';

/**
 * Высота экранной клавиатуры в CSS-переменной.
 *
 * Проверяем арифметику и порог, а не разметку: от этого числа зависит,
 * поднимется ли нижняя шторка над клавиатурой или останется под ней.
 * Ошибка здесь тихая — на десктопе не воспроизводится вовсе.
 */
describe('trackKeyboardInset', () => {
  interface FakeViewport {
    height: number;
    offsetTop: number;
    listeners: Record<string, (() => void)[]>;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
    fire(): void;
  }

  let saved: unknown;
  let savedHeight: number;
  let vv: FakeViewport;

  function fakeViewport(height: number, offsetTop = 0): FakeViewport {
    const listeners: Record<string, (() => void)[]> = {};
    return {
      height,
      offsetTop,
      listeners,
      addEventListener(type, fn) {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener(type, fn) {
        listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
      },
      fire() {
        for (const fn of listeners['resize'] ?? []) fn();
      },
    };
  }

  function inset(): string {
    return document.documentElement.style.getPropertyValue('--kb-inset');
  }

  beforeEach(() => {
    saved = (window as unknown as { visualViewport: unknown }).visualViewport;
    savedHeight = window.innerHeight;
    // innerHeight в karma — это окно раннера; фиксируем своё, чтобы
    // арифметика не зависела от размера браузера, в котором гоняют.
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vv = fakeViewport(800);
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    document.documentElement.style.removeProperty('--kb-inset');
    document.documentElement.classList.remove('kb-up');
  });

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { value: saved, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: savedHeight, configurable: true });
    document.documentElement.style.removeProperty('--kb-inset');
    document.documentElement.classList.remove('kb-up');
  });

  it('без клавиатуры зазора нет', () => {
    trackKeyboardInset();

    expect(inset()).toBe('0px');
    expect(document.documentElement.classList.contains('kb-up')).toBeFalse();
  });

  it('клавиатура в 320 px становится отступом в 320 px', () => {
    trackKeyboardInset();

    vv.height = 480;
    vv.fire();

    expect(inset()).toBe('320px');
    expect(document.documentElement.classList.contains('kb-up')).toBeTrue();
  });

  it('свёрнутая адресная строка клавиатурой не считается', () => {
    trackKeyboardInset();

    // Шестьдесят пикселей — это панель браузера, а не клавиатура.
    // Поднимать на них шторку значит дёргать её при каждой прокрутке.
    vv.height = 740;
    vv.fire();

    expect(inset()).toBe('0px');
    expect(document.documentElement.classList.contains('kb-up')).toBeFalse();
  });

  it('подкрученная страница не удваивает отступ', () => {
    trackKeyboardInset();

    // Браузер сам подкрутил страницу к полю: видимая область не только
    // меньше, но и смещена вниз. Зазор снизу от этого не вырос.
    vv.height = 480;
    vv.offsetTop = 100;
    vv.fire();

    expect(inset()).toBe('220px');
  });

  it('клавиатура убралась — отступ вернулся в ноль', () => {
    trackKeyboardInset();
    vv.height = 480;
    vv.fire();

    vv.height = 800;
    vv.fire();

    expect(inset()).toBe('0px');
    expect(document.documentElement.classList.contains('kb-up')).toBeFalse();
  });

  it('без visualViewport ничего не делает и не падает', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });

    expect(() => trackKeyboardInset()).not.toThrow();
    expect(inset()).toBe('');
  });
});
