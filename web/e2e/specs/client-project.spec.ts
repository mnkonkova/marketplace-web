import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Взгляд заказчика: условия и деньги. Проверяем то, что видно человеку,
 * а не то, что вернуло API, — суммы приходят в копейках, и ошибка в
 * делении на сто выглядит как лишние два нуля в счёте.
 */
test.beforeEach(async ({ context }) => {
  const w = world();
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, w.sessions.client] as const,
  );
});

test('клиент видит проект и условия в рублях, а не в копейках', async ({ page }) => {
  const w = world();
  await page.goto(`/me/projects/${w.projectId}`);

  await expect(page.getByText('PetFlat · UGC (e2e)')).toBeVisible({ timeout: 15_000 });

  // Оклад посеян как 6 000 000 копеек. На экране должно быть 60 000,
  // и ни в коем случае не 6 000 000.
  const body = page.locator('body');
  await expect(body).toContainText(/60\s?000/);
  await expect(body).not.toContainText(/6\s?000\s?000/);
});

/**
 * Страница проекта и виджет грузили одни и те же пять ручек: страница —
 * своей копией, которая нигде не рисовалась, виджет — для отрисовки.
 * Каждое открытие проекта било по каждой ручке дважды, и заметить это
 * можно было только в логе сервера.
 */
test('данные проекта запрашиваются по одному разу', async ({ page }) => {
  const w = world();
  const calls = new Map<string, number>();
  page.on('request', (r) => {
    const m = r
      .url()
      .match(/\/me\/projects\/[^/]+\/(videos|report|calendar|notifications|billing)/);
    if (m) calls.set(m[1], (calls.get(m[1]) ?? 0) + 1);
  });

  await page.goto(`/me/projects/${w.projectId}`);
  await expect(page.getByText('PetFlat · UGC (e2e)')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  expect(calls.get('videos'), 'лента роликов').toBe(1);
  expect(calls.get('report'), 'отчёт').toBe(1);
  expect(calls.get('calendar'), 'календарь').toBe(1);
  expect(calls.get('notifications'), 'настройки уведомлений').toBe(1);
});
