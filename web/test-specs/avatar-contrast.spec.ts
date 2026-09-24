/**
 * Контраст буквы на аватаре-плашке.
 *
 * Плашка `.av` красится классом `.a1`…`.a5` — цвет берётся от имени
 * человека, чтобы один и тот же человек выглядел одинаково на всех
 * экранах. Буква на ней раньше красилась токеном `--ink`, и это
 * разваливалось ровно там, где окно кабинета открывается поверх CRM:
 * на тёмной теме `--ink` светлый и буква была белой, а в светлом окне
 * («Проставить пачкой» в кабинете менеджера) тот же токен стал почти
 * чёрным — «А» на зелёной плашке пропала.
 *
 * Поэтому правило теперь не про тему, а про саму плашку: буква белая,
 * подложка настолько тёмная, что белая буква даёт не меньше 4.5:1 —
 * порог WCAG AA для мелкого текста. Тест держит это правило: он читает
 * настоящие значения из собранных стилей, а не список цветов из
 * соседнего файла, — иначе он проверял бы сам себя.
 */
describe('Аватар-плашка: буква читается на подложке', () => {
  const SWATCHES = ['a1', 'a2', 'a3', 'a4', 'a5'];

  /** Относительная яркость по WCAG 2.1. */
  function luminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: [number, number, number], b: [number, number, number]): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /**
   * «rgb(30, 132, 99)» → [30, 132, 99].
   *
   * Полностью прозрачный цвет — это «правило не применилось», а не
   * чёрный. Без этой проверки тест с неподключёнными стилями считал бы
   * контраст белого на «rgba(0,0,0,0)» как 21:1 и был бы зелёным,
   * ничего не проверив.
   */
  function parse(css: string): [number, number, number] | null {
    const m = css.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/);
    if (!m) return null;
    if (m[4] !== undefined && Number(m[4]) === 0) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  let host: HTMLElement;

  beforeEach(() => {
    // Словарь .crm-page живёт внутри своей обёртки: без неё правила
    // аватара не применяются вовсе, и тест мерил бы голый span.
    host = document.createElement('div');
    host.className = 'crm-shell';
    host.innerHTML =
      `<div class="crm-page">` +
      SWATCHES.map((c) => `<span class="av ${c}" data-c="${c}">А</span>`).join('') +
      `</div>`;
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('у каждой плашки подложка сплошная, а не градиент', () => {
    for (const c of SWATCHES) {
      const el = host.querySelector<HTMLElement>(`.av.${c}`)!;
      const css = getComputedStyle(el);
      // Градиент раскладывался от светлого к тёмному, и на одном из его
      // концов буква неизбежно теряла контраст: замерить «цвет фона» у
      // него нечем, а на 32 пикселях его всё равно не видно.
      expect(css.backgroundImage)
        .withContext(`${c}: подложка должна быть сплошной`)
        .toBe('none');
      expect(parse(css.backgroundColor)).withContext(`${c}: нет цвета подложки`).not.toBeNull();
    }
  });

  it('белая буква даёт не меньше 4.5:1 на каждой плашке', () => {
    for (const c of SWATCHES) {
      const el = host.querySelector<HTMLElement>(`.av.${c}`)!;
      const css = getComputedStyle(el);
      const fg = parse(css.color);
      const bg = parse(css.backgroundColor);
      expect(fg).withContext(`${c}: не прочитался цвет буквы`).not.toBeNull();
      expect(bg).withContext(`${c}: не прочитался цвет подложки`).not.toBeNull();

      const ratio = contrast(fg!, bg!);
      expect(ratio)
        .withContext(`${c}: контраст ${ratio.toFixed(2)}:1 при пороге 4.5:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('цвет буквы не зависит от темы вокруг', () => {
    // Та самая поломка: окно кабинета открывается поверх CRM и приносит
    // светлую палитру. Если буква красится токеном темы, она меняется
    // вместе с ней — а подложка у плашки своя и не меняется.
    const light = document.createElement('div');
    light.className = 'sotka';
    light.appendChild(host.cloneNode(true));
    document.body.appendChild(light);

    try {
      for (const c of SWATCHES) {
        const dark = getComputedStyle(host.querySelector<HTMLElement>(`.av.${c}`)!).color;
        const over = getComputedStyle(light.querySelector<HTMLElement>(`.av.${c}`)!).color;
        expect(over).withContext(`${c}: буква поменяла цвет вместе с темой`).toBe(dark);
      }
    } finally {
      light.remove();
    }
  });
});
