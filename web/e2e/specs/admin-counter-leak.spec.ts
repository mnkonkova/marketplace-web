import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Счётчики сайдбара — регрессия на утечку запросов.
 *
 * Пока у каждой админской страницы была своя копия оболочки, подписка на
 * NavigationEnd жила дольше компонента, и каждый следующий переход слал на
 * запрос больше предыдущего: к третьему десятку переходов рейт-лимитер
 * отвечал 429 на всю админку — страницы переставали грузиться, и выглядело
 * это как «отвалился бэк».
 *
 * Теперь оболочка стоит на родительском маршруте и переходами между
 * разделами не пересоздаётся, а цифры у пунктов приезжают вместе со
 * сводкой — одним запросом на весь заход в CRM. Экран `/admin` просит ту
 * же сводку и получает её из общего хранилища, а не вторым запросом.
 *
 * Спека сторожит не точное число, а его рост с каждым кликом.
 */
test('счётчики сайдбара не множат запросы с переходами', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.admin] as const,
  );
  let calls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/admin/summary')) calls += 1;
  });

  await page.goto('/admin/productions');
  await page.waitForTimeout(800);
  const nav = page.locator('.crm-shell .side');
  // Имя пункта берём частью: рядом с ним стоит счётчик, и точное
  // совпадение ловило бы «Проекты 18», а не «Проекты».
  for (const name of [
    'Сводка',
    'Проекты',
    'Команда',
    'Специалисты',
    'Прайс',
    'Документы',
    'Воронки',
  ]) {
    await nav.locator('a.nav').filter({ hasText: name }).first().click();
    await page.waitForTimeout(400);
  }

  // С утечкой на седьмом переходе запросов было бы под три десятка.
  expect(calls, `запросов сводки: ${calls}`).toBeLessThan(12);
});
