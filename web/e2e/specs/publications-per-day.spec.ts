import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/**
 * Несколько роликов в один день — весь путь через интерфейс.
 *
 * День съёмки один, роликов из него выходит несколько. До этого план
 * такого сказать не умел: уникальность стояла по паре «креатор и день»,
 * и менеджер разносил ролики по соседним датам, к работе отношения не
 * имевшим, — а отчёт потом считал выработку по этим выдуманным дням.
 *
 * Проверяются оба пути, которыми ролики попадают в план: пачкой (число
 * «роликов в каждый день») и по одному прямо в сетке. Юнит-специи
 * считают арифметику, здесь важно другое — что запрос доходит, сервер
 * ставит ролику номер в дне, а клетка показывает их число и даёт
 * добраться до каждого.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('perday');
});

test.afterAll(() => dropSandbox(box));

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${box.projectId}`);
  // На десктопе разделы — вкладками; план — своя.
  await openManagerTab(page, 'План выкладок');
});

const dialog = (page: import('@playwright/test').Page) =>
  page.locator('.ant-modal-content', { hasText: 'Дни выкладки' });

/** Убрать созданную пачку: чужие специи идут по тому же проекту. */
async function cancelBatch(projectId: string, batchId: string): Promise<void> {
  const api = await pwRequest.newContext({
    baseURL: process.env.E2E_API ?? 'http://127.0.0.1:8080',
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
  });
  await api.post(`/api/v1/manager/projects/${projectId}/publications/cancel_batch`, {
    data: { batch_id: batchId },
  });
  await api.dispose();
  psql(`DELETE FROM project_publications WHERE created_batch_id = '${batchId}';`);
}

test('пачка ставит по два ролика в день, и клетка показывает их число', async ({ page }) => {
  await expect(page.locator('.tbl-wrap .grid-plan')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Проставить пачкой' }).click();
  const d = dialog(page);
  await expect(d).toBeVisible({ timeout: 15_000 });

  // Свободный будущий день: занятый снять нельзя, и число в клетке
  // тогда считалось бы вместе с чужими выкладками.
  const free = d.locator('.mcal .dc:not(.pad):not(.past):not(.sel):not(.set)').first();
  await expect(free).toBeVisible();
  const day = await free.textContent();
  await free.click();

  // Сколько роликов в каждый день. По умолчанию один — ставим два.
  const perDay = d.getByLabel('Роликов в каждый день');
  await expect(perDay).toHaveValue('1');
  await perDay.fill('2');
  await perDay.blur();

  // Счётчик считает МЕСТА в дне, а не дни: обещать «1 новая выкладка»
  // там, где заведутся две, — соврать про объём работы. Сравниваем с
  // тем, что сервер реально завёл: число на кнопке и число строк в
  // плане обязаны совпадать, иначе окно врёт про объём работы.
  const promised = Number((await d.locator('.summarybar b').textContent())?.trim());
  expect(promised).toBeGreaterThanOrEqual(2);

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/publications/batch') && r.request().method() === 'POST',
    ),
    d.getByRole('button', { name: /Создать выкладки|Добавить даты/ }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json();
  expect(body.created, 'сколько обещали, столько и завели').toBe(promised);

  // На выбранном дне — два ролика с номерами подряд с первого. Номера
  // ставит сервер: клиент о них не знает и знать не должен.
  const tail = `-${String(Number(day)).padStart(2, '0')}`;
  const slots = body.items
    .filter((p: { due_date: string }) => p.due_date.slice(0, 10).endsWith(tail))
    .map((p: { day_slot: number }) => p.day_slot)
    .sort();
  expect(slots, 'два ролика на выбранный день').toEqual([1, 2]);

  await expect(d).toBeHidden();

  // Клетка этого дня показывает ЧИСЛО роликов, а не значок одного из
  // них: значок говорил бы про какой-то один, и про какой — неизвестно.
  // Ищем по подсказке, а не по тексту клетки: Angular рисует число
  // внутри блочного @if с отступами, и регулярка по textContent на этих
  // переводах строки не сходится — текст сверяем отдельно, обрезав.
  const cell = page.locator('.tbl-wrap .grid-plan .c[title*="ролика"]').first();
  await expect(cell).toBeVisible({ timeout: 10_000 });
  expect((await cell.textContent())?.trim()).toBe('2');

  // По нажатию — список дня, из которого выбирают конкретный ролик.
  await cell.click();
  const list = page.locator('.day-list .dl');
  await expect(list).toHaveCount(2);
  await expect(list.first()).toContainText('Ролик 1');
  await expect(list.nth(1)).toContainText('Ролик 2');

  // И до правки второго ролика можно добраться, а из неё вернуться.
  await list.nth(1).click();
  await expect(page.getByRole('button', { name: 'Перенести' })).toBeVisible();
  await page.getByRole('button', { name: /все 2 ролика дня/ }).click();
  await expect(list).toHaveCount(2);

  await cancelBatch(box.projectId, body.batch_id);
});

test('«+ ролик в этот день» добавляет второй ролик прямо в сетке', async ({ page }) => {
  await expect(page.locator('.tbl-wrap .grid-plan')).toBeVisible({ timeout: 15_000 });

  // Пустая будущая клетка — кнопка «поставить выкладку». Ставим одну…
  const empty = page.locator('.tbl-wrap .grid-plan .c:not(.p):not(.d):not(.r):not(.l)').last();
  await empty.click();
  // Кнопки ищем ВНУТРИ строки правки: у пустых клеток сетки в
  // aria-label тоже написано «поставить выкладку», и по имени их
  // тридцать одна.
  const edit = page.locator('.edit');
  const [first] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/publications') && r.request().method() === 'POST',
    ),
    edit.getByRole('button', { name: 'Поставить выкладку' }).click(),
  ]);
  expect(first.status(), await first.text()).toBe(201);
  const one = await first.json();
  expect(one.day_slot, 'первый ролик дня').toBe(1);

  // …а затем вторую в тот же день: раньше сервер отвечал 409 «на эту
  // дату у вас уже есть выкладка», и второй ролик поставить было нечем.
  const cell = page.locator(`.tbl-wrap .grid-plan .c.p`).last();
  await cell.click();
  const [second] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/publications') && r.request().method() === 'POST',
    ),
    edit.getByRole('button', { name: '+ ролик в этот день' }).click(),
  ]);
  expect(second.status(), await second.text()).toBe(201);
  const two = await second.json();
  expect(two.day_slot, 'второй ролик того же дня').toBe(2);
  expect(two.due_date.slice(0, 10)).toBe(one.due_date.slice(0, 10));

  psql(`DELETE FROM project_publications WHERE id IN ('${one.id}', '${two.id}');`);
});
