import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/**
 * Этап согласования черновика — настройка проекта, но спрашивается она
 * в окне простановки дат, и только там.
 *
 * Со страницы проекта тумблер убран намеренно: решение «нужен ли
 * черновик» принимают ровно тогда, когда видно, на какие дни встанут
 * сроки, — а не заранее в настройках, куда за ним отдельно идти.
 * Настройка при этом остаётся ПРОЕКТНОЙ: включённый этап добавляет
 * каждой новой выкладке второй срок, по которому пингует бот.
 *
 * Проверяем не «класс сменился», а что настройка пережила перезагрузку:
 * сохраняется она после создания выкладок и молча, так что экран может
 * выглядеть правильным, пока сервер ничего не знает.
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

async function managerApi() {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
  });
}

async function setDraft(required: boolean): Promise<void> {
  const api = await managerApi();
  await api.put(`/api/v1/manager/projects/${box.projectId}/settings`, {
    data: { draft_required: required, client_sees_stats: true },
  });
  await api.dispose();
}

async function draftRequired(): Promise<boolean> {
  const api = await managerApi();
  const res = await api.get(`/api/v1/manager/projects/${box.projectId}/settings`);
  const body = await res.json();
  await api.dispose();
  return body.draft_required === true;
}

/**
 * Унести созданные этой спекой выкладки.
 *
 * Отмены мало: отменённая выкладка остаётся строкой проекта, и за десяток
 * прогонов их набираются десятки. Ручки удаления у выкладок нет и быть не
 * должно, поэтому строки теста уносим SQL'ем — по его же batch_id.
 */
async function cancelBatch(batchId: string): Promise<void> {
  const api = await managerApi();
  await api.post(`/api/v1/manager/projects/${box.projectId}/publications/cancel_batch`, {
    data: { batch_id: batchId },
  });
  await api.dispose();
  psql(`DELETE FROM project_publications WHERE created_batch_id = '${batchId}';`);
}

// nz-modal не связывает заголовок с ролью dialog через aria-labelledby,
// поэтому ищем по самому окну, а не по доступному имени.
const dialog = (page: import('@playwright/test').Page) =>
  page.locator('.ant-modal-content', { hasText: 'Дни выкладки' });

const toggle = (page: import('@playwright/test').Page) =>
  dialog(page)
    .locator('.switchrow', { hasText: 'Этап согласования черновика' })
    .locator('button.sw');

const isOn = async (page: import('@playwright/test').Page): Promise<boolean> =>
  ((await toggle(page).getAttribute('class')) ?? '').includes('on');

async function openDialog(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Проставить пачкой' }).click();
  await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ context, page }) => {
  await setDraft(false);
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${box.projectId}`);
  // На десктопе разделы — вкладками; план — своя.
  await openManagerTab(page, 'План выкладок');
});

test.afterEach(async () => {
  await setDraft(false);
});

test('тумблера черновика на странице проекта нет — он только в простановке пачкой', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: 'Проставить пачкой' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.switchrow', { hasText: 'Этап согласования черновика' })).toHaveCount(
    0,
  );

  await openDialog(page);
  await expect(toggle(page)).toBeVisible();
});

test('включённый в окне этап черновика переживает перезагрузку', async ({ page }) => {
  await openDialog(page);
  expect(await isOn(page), 'по умолчанию этап выключен').toBe(false);

  await toggle(page).click();
  await expect.poll(() => isOn(page), { timeout: 5_000, message: 'тумблер отозвался' }).toBe(true);

  // Настройка сохраняется ПОСЛЕ создания выкладок: пока пачку не завели,
  // решения ещё нет. Берём свободный будущий день — не прошедший и не
  // стоящий в плане.
  const d = dialog(page);
  const free = d.locator('.mcal .dc:not(.pad):not(.past):not(.sel):not(.set)').first();
  await expect(free).toBeVisible();
  await free.click();

  const [batch] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/publications/batch') && r.request().method() === 'POST',
    ),
    d.getByRole('button', { name: /Создать выкладки|Добавить даты/ }).click(),
  ]);
  expect(batch.status(), await batch.text()).toBe(201);

  await expect
    .poll(draftRequired, { timeout: 10_000, message: 'настройка доехала до сервера' })
    .toBe(true);

  await page.reload();
  await openDialog(page);
  await expect
    .poll(() => isOn(page), { timeout: 10_000, message: 'включённое должно остаться включённым' })
    .toBe(true);

  await cancelBatch((await batch.json()).batch_id);
});

test('нетронутый тумблер настройку проекта не переписывает', async ({ page }) => {
  await setDraft(true);
  await page.reload();
  await openDialog(page);

  // Окно открылось на записанном значении, а не на подсказке с карточки.
  await expect.poll(() => isOn(page), { timeout: 10_000 }).toBe(true);

  const d = dialog(page);
  const free = d.locator('.mcal .dc:not(.pad):not(.past):not(.sel):not(.set)').first();
  await expect(free).toBeVisible();
  await free.click();

  const [batch] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/publications/batch') && r.request().method() === 'POST',
    ),
    d.getByRole('button', { name: /Создать выкладки|Добавить даты/ }).click(),
  ]);
  expect(batch.status(), await batch.text()).toBe(201);

  expect(await draftRequired(), 'включённое не выключилось само').toBe(true);

  await cancelBatch((await batch.json()).batch_id);
});
