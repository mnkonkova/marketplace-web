import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Счётчик модерации в сайдбаре — регрессия на утечку подписки.
 *
 * У каждой админской страницы своя копия оболочки, и переход между
 * разделами её пересоздаёт. Пока подписка на NavigationEnd жила дольше
 * компонента, каждый следующий переход слал на запрос больше предыдущего:
 * к третьему десятку переходов рейт-лимитер отвечал 429 на всю админку —
 * страницы переставали грузиться, и выглядело это как «отвалился бэк».
 */
test('счётчик модерации не множится с переходами', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.admin] as const,
  );
  let calls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/moderation/specialists/count')) calls += 1;
  });

  await page.goto('/admin/productions');
  await page.waitForTimeout(800);
  const nav = page.locator('.admin-nav');
  for (const name of ['Проекты', 'Менеджеры', 'Пользователи', 'Прайс', 'Продакшены', 'Воронки']) {
    await nav.getByRole('link', { name, exact: true }).click();
    await page.waitForTimeout(400);
  }
  // По одному запросу на экран: семь экранов — семь запросов. Порог с
  // запасом; с утечкой на седьмом переходе их было бы под три десятка.
  expect(calls, `запросов счётчика: ${calls}`).toBeLessThan(12);
});
