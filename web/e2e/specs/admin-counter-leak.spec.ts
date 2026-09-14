import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Счётчик модерации в сайдбаре — регрессия на утечку подписки.
 *
 * Пока у каждой админской страницы была своя копия оболочки, подписка на
 * NavigationEnd жила дольше компонента, и каждый следующий переход слал
 * на запрос больше предыдущего: к третьему десятку переходов рейт-лимитер
 * отвечал 429 на всю админку — страницы переставали грузиться, и
 * выглядело это как «отвалился бэк».
 *
 * Теперь оболочка стоит на родительском маршруте и переходами между
 * разделами не пересоздаётся, так что запрос должен уйти ровно один раз
 * на весь заход в CRM. Порог оставлен с запасом: проверяем не точное
 * число, а что оно не растёт с каждым кликом.
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
  const nav = page.locator('.crm-shell .side');
  for (const name of ['Проекты', 'Команда', 'Специалисты', 'Прайс', 'Продакшены', 'Воронки']) {
    await nav.getByRole('link', { name, exact: true }).click();
    await page.waitForTimeout(400);
  }
  // С утечкой на седьмом переходе их было бы под три десятка.
  expect(calls, `запросов счётчика: ${calls}`).toBeLessThan(12);
});
