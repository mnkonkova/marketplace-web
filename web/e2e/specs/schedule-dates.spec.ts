import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql, world } from '../fixtures/world';

/**
 * Убрать созданную пачку.
 *
 * Специи идут по одному посеянному проекту, и полтора десятка выкладок,
 * оставленных этим тестом, меняют картину у соседей: у креатора «сдано
 * 1 из 1» превращается в «1 из 16». Чистим сразу, а не полагаясь на
 * следующий посев.
 *
 * Отмены мало: отменённая выкладка остаётся строкой проекта, и за десяток
 * прогонов их набирались десятки — именно они и превращали план в «закрыто
 * 1 из 1, отменённых скрыто: 36». Ручки удаления у выкладок нет и быть не
 * должно, поэтому строки теста уносим SQL'ем — по его же batch_id, чужого
 * не трогая.
 */
async function cancelBatch(projectId: string, batchId: string): Promise<void> {
  const api = await pwRequest.newContext({
    baseURL: process.env.E2E_API ?? 'http://127.0.0.1:8080',
    extraHTTPHeaders: {
      Authorization: `Bearer ${world().sessions.manager.access_token}`,
    },
  });
  await api.post(`/api/v1/manager/projects/${projectId}/publications/cancel_batch`, {
    data: { batch_id: batchId },
  });
  await api.dispose();
  psql(`DELETE FROM project_publications WHERE created_batch_id = '${batchId}';`);
}

/**
 * Простановка дат пачкой — весь путь через диалог.
 *
 * Даты уходят на сервер списком, выбранным в календаре. Поодиночке такие
 * выкладки не заводят вовсе, так что если этот путь сломан — проект
 * завести нечем. Юнит-тесты проверяют арифметику заготовок, здесь важно
 * другое: что запрос вообще доходит и строки появляются в плане.
 */
test.beforeEach(async ({ context, page }) => {
  const w = world();
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, w.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${w.projectId}`);
});

// nz-modal не связывает заголовок с ролью dialog через aria-labelledby,
// поэтому ищем по самому окну, а не по доступному имени.
const dialog = (page: import('@playwright/test').Page) =>
  page.locator('.ant-modal-content', { hasText: 'Дни выкладки' });

test('выбранные в календаре дни создают выкладки', async ({ page }) => {
  const plan = page.locator('.slot');
  const before = await plan.count();

  await page.getByRole('button', { name: 'Проставить даты' }).click();
  const d = dialog(page);
  await expect(d).toBeVisible({ timeout: 15_000 });

  // Креатор в составе один — его и выбираем по имени.
  await d.getByRole('button', { name: /Анастасия/ }).click();

  // Свободные будущие дни: календарь гасит прошедшие, а занятые даты
  // сервер молча пропустит по уникальному индексу «креатор + день».
  await d.getByRole('button', { name: 'Через день' }).click();

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/publications/batch') && r.request().method() === 'POST',
    ),
    d.getByRole('button', { name: 'Создать выкладки' }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(201);

  const body = await response.json();
  expect(body.created, 'сервер сообщает, сколько строк завёл').toBeGreaterThan(0);

  // И они видны в плане, а не только в ответе.
  await expect(d).toBeHidden();
  await expect.poll(() => plan.count(), { timeout: 10_000 }).toBeGreaterThan(before);

  await cancelBatch(world().projectId, body.batch_id);
});

test('без выбранного креатора создать нельзя', async ({ page }) => {
  await page.getByRole('button', { name: 'Проставить даты' }).click();
  const d = dialog(page);
  await expect(d).toBeVisible({ timeout: 15_000 });

  const submit = d.getByRole('button', { name: 'Создать выкладки' });
  await expect(submit, 'пустая форма не отправляется').toBeDisabled();

  // Дни есть, людей нет — по-прежнему нечего создавать: пачка это
  // «креаторы × дни», и без одного из множителей она пустая.
  await d.getByRole('button', { name: 'Вт и Чт' }).click();
  await expect(submit).toBeDisabled();

  // А с человеком — можно.
  await d.getByRole('button', { name: /Анастасия/ }).click();
  await expect(submit).toBeEnabled();
});
