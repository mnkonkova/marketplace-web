import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Этап согласования черновика — переключатель проекта.
 *
 * Он меняет не оформление, а работу: включённый добавляет каждой новой
 * выкладке второй срок, по которому пингует бот. Тумблер отзывается
 * оптимистично, поэтому проверяем не «класс сменился», а что настройка
 * пережила перезагрузку — иначе экран выглядит правильным, а сервер
 * ничего не знает.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

/**
 * Проект — свой, заведённый этой спекой и снесённый после.
 *
 * Общий посеянный проект специи делили на всех, и любая правка состояния
 * доезжала до соседей: лишняя выкладка меняла «сдано 1 из 1» на «1 из
 * 16», отметка занятости ломала сбор заказа через два файла. Песочница
 * собирается настоящим API теми же запросами, что шлёт интерфейс, и
 * сносится в afterAll — он отрабатывает и после падения теста.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('draft');
});

test.afterAll(() => dropSandbox(box));

async function setDraft(required: boolean): Promise<void> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
  });
  await api.put(`/api/v1/manager/projects/${box.projectId}/settings`, {
    data: { draft_required: required, client_sees_stats: true },
  });
  await api.dispose();
}

const toggle = (page: import('@playwright/test').Page) =>
  page.locator('.switchrow', { hasText: 'Этап согласования черновика' }).locator('button.sw');

const isOn = async (page: import('@playwright/test').Page): Promise<boolean> =>
  ((await toggle(page).getAttribute('class')) ?? '').includes('on');

test.beforeEach(async ({ context, page }) => {
  await setDraft(false);
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${box.projectId}`);
});

test.afterEach(async () => {
  await setDraft(false);
});

test('включённый этап черновика переживает перезагрузку', async ({ page }) => {
  await expect(toggle(page)).toBeVisible({ timeout: 15_000 });
  expect(await isOn(page), 'по умолчанию этап выключен').toBe(false);

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/projects/${box.projectId}/settings`) && r.request().method() === 'PUT',
    ),
    toggle(page).click(),
  ]);
  expect(response.status(), 'настройка сохранена').toBe(200);
  expect((await response.json()).draft_required).toBe(true);

  await page.reload();
  await expect(toggle(page)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => isOn(page), { timeout: 10_000, message: 'включённое должно остаться включённым' })
    .toBe(true);
});

test('отказ сервера возвращает тумблер, а не оставляет его переключённым', async ({ page }) => {
  await expect(toggle(page)).toBeVisible({ timeout: 15_000 });

  await page.route('**/settings', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, body: '{"error":"internal"}' })
      : route.continue(),
  );

  await toggle(page).click();
  await expect
    .poll(() => isOn(page), { timeout: 10_000, message: 'после отказа состояние должно вернуться' })
    .toBe(false);
});
