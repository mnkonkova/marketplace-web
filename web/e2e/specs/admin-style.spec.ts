import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Админский кабинет живёт в общем языке интерфейса.
 *
 * До этого он не входил в область дизайн-системы: поля и селекты
 * рисовались дефолтом ant — светлая тема и скругление 2px посреди тёмной
 * страницы, — а собственные радиусы гуляли от 4 до 999px. Отдельный тест
 * нужен потому, что подключение делается одной строкой в списке
 * селекторов, и выпасть оттуда так же незаметно, как попасть.
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.admin] as const,
  );
});

test('поля и кнопки админки — в системном стиле, а не в дефолте ant', async ({ page }) => {
  await page.goto('/admin/users');

  const search = page.locator('input[nz-input]').first();
  await expect(search).toBeVisible({ timeout: 15_000 });

  // 10px — радиус поля из дизайн-системы. Дефолт ant здесь 2px.
  await expect(search).toHaveCSS('border-radius', '10px');

  // Поле должно стоять на тёмной поверхности: светлый фон ant тут
  // читался бы как чужой элемент.
  const bg = await search.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, 'поле не должно быть светлым').not.toMatch(/rgb\(255,\s*255,\s*255\)/);
});

test('широкая таблица прокручивается внутри себя, а не обрезается', async ({ page }) => {
  await page.goto('/admin/users');
  const table = page.locator('.ant-table-content').first();
  await expect(table).toBeVisible({ timeout: 15_000 });

  // Колонка действий — последняя из десяти, и без прокрутки её кнопки
  // просто не достать.
  const box = await table.evaluate((el) => ({
    scrollable: el.scrollWidth > el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(box.overflowX, 'таблица обязана иметь свою прокрутку').toBe('auto');

  // И при этом страница целиком вбок ехать не должна.
  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(pageScrolls, 'горизонтальная прокрутка страницы').toBe(false);
});
