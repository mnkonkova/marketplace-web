import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

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
      Authorization: `Bearer ${box.sessions.manager.access_token}`,
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
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${box.projectId}`);
});

// nz-modal не связывает заголовок с ролью dialog через aria-labelledby,
// поэтому ищем по самому окну, а не по доступному имени.
const dialog = (page: import('@playwright/test').Page) =>
  page.locator('.ant-modal-content', { hasText: 'Дни выкладки' });

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
  box = await createSandbox('sched');
});

test.afterAll(() => dropSandbox(box));

test('выбранные в календаре дни создают выкладки', async ({ page }) => {
  // Занятая клетка плана: пустая тоже `.c` — она кнопка «поставить
  // выкладку», — поэтому считаем только те, у которых есть состояние.
  // Берём таблицу десктопа: телефонная лента рядом в разметке, и без
  // этой рамки каждая выкладка считалась бы дважды.
  const plan = page.locator(
    '.tbl-wrap .grid-plan .c.p, .tbl-wrap .grid-plan .c.d, .tbl-wrap .grid-plan .c.r, .tbl-wrap .grid-plan .c.l',
  );
  await expect(page.locator('.tbl-wrap .grid-plan')).toBeVisible({ timeout: 15_000 });
  const before = await plan.count();

  await page.getByRole('button', { name: 'Проставить пачкой' }).click();
  const d = dialog(page);
  await expect(d).toBeVisible({ timeout: 15_000 });

  // Окно открывается НА ТЕКУЩЕМ ПЛАНЕ: состав и уже назначенные дни
  // отмечены. Раньше оно открывалось пустым, и человек, думая что правит
  // план, добавлял к нему второй комплект дат.
  await expect(d.locator('.pick.on').first()).toBeVisible();

  // Берём свободный будущий день — не прошедший, не уже стоящий в плане.
  // Занятый день снять нельзя (ручки отмены одной выкладки у API нет),
  // поэтому выбираем именно тот, которого в плане ещё нет.
  const free = d.locator('.mcal .dc:not(.pad):not(.past):not(.sel):not(.set)').first();
  await expect(free).toBeVisible();
  await free.click();

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/publications/batch') && r.request().method() === 'POST',
    ),
    d.getByRole('button', { name: /Создать выкладки|Добавить даты/ }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(201);

  const body = await response.json();
  expect(body.created, 'сервер сообщает, сколько строк завёл').toBeGreaterThan(0);

  // И они видны в плане, а не только в ответе.
  await expect(d).toBeHidden();
  await expect.poll(() => plan.count(), { timeout: 10_000 }).toBeGreaterThan(before);

  await cancelBatch(box.projectId, body.batch_id);
});

test('без выбранного креатора создать нельзя', async ({ page }) => {
  await page.getByRole('button', { name: 'Проставить пачкой' }).click();
  const d = dialog(page);
  await expect(d).toBeVisible({ timeout: 15_000 });

  // Подпись зависит от того, есть ли уже даты в плане: на пустом плане
  // «Создать выкладки», на непустом «Добавить даты». Проверяем кнопку
  // подтверждения, а не её текст.
  const submit = d.getByRole('button', { name: /Создать выкладки|Добавить даты/ });

  // Снимаем весь состав: пачка — это «креаторы × дни», и без одного из
  // множителей создавать нечего, сколько дней ни отметь.
  const picked = d.locator('.pick.on');
  for (let i = await picked.count(); i > 0; i -= 1) {
    await picked.first().click();
  }
  await expect(submit, 'без креаторов отправлять нечего').toBeDisabled();

  // Дни есть, людей нет — по-прежнему нечего создавать: пачка это
  // «креаторы × дни», и без одного из множителей она пустая.
  //
  // Сперва уходим на СЛЕДУЮЩИЙ месяц. Заготовка ставит галочки только
  // на будущие дни показанного месяца, и в последние числа их там не
  // остаётся вовсе: 30 сентября 2026 — среда, ни одного вторника и
  // четверга впереди. Спека тогда падала не по делу, раз в месяц, на
  // «кнопка всё ещё выключена».
  await d.getByRole('button', { name: 'Вперёд' }).click();
  await d.getByRole('button', { name: 'Вт и Чт' }).click();
  await expect(submit).toBeDisabled();

  // А с человеком — можно.
  await d.getByRole('button', { name: box.creator.name }).click();
  await expect(submit).toBeEnabled();
});
