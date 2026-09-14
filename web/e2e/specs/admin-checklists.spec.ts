import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Библиотека чеклистов у админа.
 *
 * Шаблон уходит в проект снимком, поэтому правки на месте здесь нет:
 * «сохранить» выпускает следующую версию и гасит прежнюю. Тест держит
 * именно это правило — если однажды заменить его на UPDATE, у идущих
 * проектов молча поменяются требования, по которым уже сдавали.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

async function adminApi() {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.admin.access_token}` },
  });
}

/** Убрать шаблон, чтобы прогоны не копили библиотеку. */
async function dropTemplate(name: string): Promise<void> {
  const api = await adminApi();
  const res = await api.get('/api/v1/admin/checklist_templates');
  for (const t of ((await res.json()).items ?? []) as { id: string; name: string }[]) {
    if (t.name === name) await api.delete(`/api/v1/admin/checklist_templates/${t.id}`);
  }
  await api.dispose();
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.admin] as const,
  );
  await page.goto('/admin/checklists');
});

test('админ заводит чеклист и правит его новой версией', async ({ page }) => {
  const name = `E2E чеклист ${Date.now()}`;
  try {
    await page.getByRole('button', { name: 'Новый чеклист' }).click();
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await modal.getByPlaceholder('Например').fill(name);
    await modal.getByPlaceholder('Что проверить перед сдачей').first().fill('Товар в кадре');

    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/admin/checklist_templates') && r.request().method() === 'POST',
      ),
      modal.getByRole('button', { name: 'Сохранить' }).click(),
    ]);
    expect(created.status(), await created.text()).toBe(201);
    expect((await created.json()).version, 'первый выпуск — версия 1').toBe(1);

    const card = page.locator('.tpl').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText('версия 1');

    // Правка — это новая версия, а не переписанная старая.
    await card.getByRole('button', { name: 'Изменить' }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.locator('.modal').getByRole('button', { name: 'Добавить пункт' }).click();
    await page
      .locator('.modal')
      .getByPlaceholder('Что проверить перед сдачей')
      .last()
      .fill('Артикул в описании');

    const [released] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/admin/checklist_templates') && r.request().method() === 'POST',
      ),
      page.locator('.modal').getByRole('button', { name: 'Выпустить версию' }).click(),
    ]);
    expect((await released.json()).version, 'правка выпускает версию 2').toBe(2);

    // В библиотеке остаётся одна карточка — новая. Погашенная не висит.
    await expect(page.locator('.tpl').filter({ hasText: name })).toHaveCount(1);
    await expect(page.locator('.tpl').filter({ hasText: name })).toContainText('версия 2');
  } finally {
    await dropTemplate(name);
  }
});

test('чеклист без названия и без пунктов не сохраняется', async ({ page }) => {
  await page.getByRole('button', { name: 'Новый чеклист' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible({ timeout: 15_000 });

  let sent = false;
  page.on('request', (r) => {
    if (r.url().endsWith('/admin/checklist_templates') && r.request().method() === 'POST') {
      sent = true;
    }
  });

  await modal.getByRole('button', { name: 'Сохранить' }).click();
  await page.waitForTimeout(600);
  expect(sent, 'пустая форма на сервер не уходит').toBe(false);
  await expect(modal).toBeVisible();
});
