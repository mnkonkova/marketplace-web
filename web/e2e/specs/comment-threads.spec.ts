import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Переписка разложена по веткам, а редактор один на все.
 *
 * Пока черновик не переезжал вместе с веткой, набранная внутренняя
 * заметка оставалась в поле при переключении вкладки — и уходила клиенту,
 * если между набором и отправкой заглянуть в клиентскую ветку. Ошибка
 * тихая: отправка проходит успешно, просто не туда, и увидеть это можно
 * только со стороны клиента.
 */
test.beforeEach(async ({ context, page }) => {
  const w = world();
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, w.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${w.projectId}`);
  await page.getByRole('button', { name: /^Комментарии/ }).click();
});

const editor = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Комментарий' });

// Вкладки веток — role="tab", а не button: их и ищем по роли.
const thread = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('tab', { name });

test('черновик остаётся в своей ветке при переключении вкладок', async ({ page }) => {
  const ed = editor(page);
  await expect(ed).toBeVisible({ timeout: 15_000 });

  await thread(page, 'Только менеджерам').click();
  await ed.click();
  await ed.pressSequentially('внутренняя заметка');
  await expect(ed).toHaveText('внутренняя заметка');

  // Клиентская ветка обязана открыться пустой — иначе «Отправить»
  // отправит заказчику внутреннюю заметку.
  await thread(page, 'С заказчиком').click();
  await expect(ed).toHaveText('');

  // А заметка не потеряна: она ждёт в своей ветке.
  await thread(page, 'Только менеджерам').click();
  await expect(ed).toHaveText('внутренняя заметка');
});

test('сообщение уходит в ту ветку, что открыта', async ({ page }) => {
  const ed = editor(page);
  await expect(ed).toBeVisible({ timeout: 15_000 });

  await thread(page, 'Только менеджерам').click();
  await ed.click();
  await ed.pressSequentially('черновик, который не должен уехать');

  await thread(page, 'С заказчиком').click();
  await ed.click();
  const text = `вопрос заказчику ${Date.now()}`;
  await ed.pressSequentially(text);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/comments') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Отправить' }).click(),
  ]);
  expect(response.status(), 'комментарий сохранён').toBe(201);

  const body = await response.json();
  expect(body.thread, 'ветка — та, что открыта').toBe('client');
  expect(body.body, 'внутренняя заметка в клиентскую ветку не попала').not.toContain('черновик');
});
