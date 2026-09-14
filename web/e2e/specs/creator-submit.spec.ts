import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * «Сдать ролик» у креатора.
 *
 * Окно собрано из словаря макета (.ovl / .modal), и пока этих правил не
 * было в стилях, разметка не переставала работать — она переставала быть
 * окном: блок утекал в конец страницы без подложки и центрирования.
 * Нажатие выглядело как «кнопка никуда не ведёт», хотя обработчик
 * отрабатывал. Поэтому проверяем не «модалка в DOM», а что она видна и
 * лежит поверх страницы.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

/** Открытая выкладка на послезавтра — сдавать её и будем. */
async function seedOpenPublication(): Promise<string> {
  const w = world();
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${w.sessions.manager.access_token}` },
  });
  const crew = await api.get(`/api/v1/manager/projects/${w.projectId}/creators`);
  const creatorId = (await crew.json()).items[0].user_id as string;
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const res = await api.post(`/api/v1/manager/projects/${w.projectId}/publications/batch`, {
    data: { creator_user_ids: [creatorId], dates: [due] },
  });
  const body = await res.json();
  await api.dispose();
  return body.batch_id as string;
}

async function dropBatch(batchId: string): Promise<void> {
  const w = world();
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${w.sessions.manager.access_token}` },
  });
  await api.post(`/api/v1/manager/projects/${w.projectId}/publications/cancel_batch`, {
    data: { batch_id: batchId },
  });
  await api.dispose();
}

test('окно сдачи открывается поверх страницы', async ({ context, page }) => {
  const batchId = await seedOpenPublication();
  try {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, world().sessions.creator] as const,
    );
    await page.goto(`/me/creator/projects/${world().projectId}`);

    const submit = page.getByRole('button', { name: 'Сдать ролик' }).first();
    await expect(submit, 'у открытой выкладки есть чем сдать').toBeVisible({ timeout: 15_000 });
    await submit.click();

    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    await expect(modal).toBeVisible();

    // Окно, а не блок в конце страницы: подложка на весь экран и
    // позиционирование fixed.
    const overlay = page.locator('.ovl.on');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('position', 'fixed');

    // Поля под все пять площадок — сдать можно не все сразу.
    await expect(modal.locator('input[type="url"]')).toHaveCount(5);

    // И закрывается.
    await modal.getByRole('button', { name: 'Отмена' }).click();
    await expect(modal).toBeHidden();
  } finally {
    await dropBatch(batchId);
  }
});
