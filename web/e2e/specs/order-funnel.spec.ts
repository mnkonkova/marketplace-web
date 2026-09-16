import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Воронка заказа «под ключ» глазами заказчика.
 *
 * Проверяем то, что ломается тихо, а не наличие блоков в разметке:
 *   • вторая ветка («видео под ключ») не ведёт в никуда — экрана ещё нет,
 *     и вместо пустой страницы человек должен получить объяснение;
 *   • смета пересчитывается на изменение состава и совпадает с той, что
 *     потом придёт по созданному заказу: стухшее число на экране — это
 *     обещание цены, которой не будет;
 *   • лимит месяца уважается — лишние уходят в резерв, а не в состав, и
 *     на сервер идёт needed не больше разрешённого;
 *   • состав уходит В ПОРЯДКЕ ПРИОРИТЕТА, а не в порядке кликов: порядок
 *     здесь — это очередь приглашений, и перепутать его значит позвать
 *     не того.
 *
 * Заказы за собой убираем: специи идут по одному посеянному миру, а
 * живой заказ меняет и лимит соседям, и картину у креатора.
 */

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
  box = await createSandbox('funnel', { shape: 'empty', ownClient: true });
});

test.afterAll(() => dropSandbox(box));

const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

async function clientApi(): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.client.access_token}` },
  });
}

/** Отменить заказ, заведённый тестом. */
async function cancelOrder(id: string): Promise<void> {
  const api = await clientApi();
  await api.post(`/api/v1/me/orders/${id}/cancel`);
  await api.dispose();
}

/**
 * Копейки → та же строка, что рисует formatMoney на экране.
 *
 * Повторяем форматирование намеренно: сравнивать надо именно ТЕКСТ на
 * экране с ЧИСЛОМ, которое отдал сервер. Позвать сюда функцию приложения
 * значило бы проверить её саму собой.
 */
function money(kopecks: number): string {
  const nbsp = '\u00a0';
  const rub = Math.floor(kopecks / 100);
  const head = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  const kop = kopecks % 100;
  return kop === 0 ? `${head}${nbsp}₽` : `${head},${String(kop).padStart(2, '0')}${nbsp}₽`;
}

/** Имя из каталога → user_id: в запросе к серверу лежат id, на экране имена. */
async function catalogByName(): Promise<Map<string, string>> {
  const api = await pwRequest.newContext({ baseURL: API });
  const res = await api.get('/api/v1/search?category=blogger,ugc&limit=50');
  const items = ((await res.json()).items ?? []) as { user_id: string; display_name: string }[];
  await api.dispose();
  return new Map(items.map((i) => [i.display_name, i.user_id]));
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.client] as const,
  );
  await page.goto('/me/projects');
});

/** Дождаться пересчёта сметы: она уходит с задержкой после клика. */
const estimateCall = (page: import('@playwright/test').Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith('/me/orders/estimate') && r.request().method() === 'POST',
  );

/** Дойти от кабинета до шага подбора с загруженным каталогом. */
async function openPicking(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Посчитать смету' }).click();
  await expect(page.getByRole('heading', { name: 'Что делаем?' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.kind.k1').click();
  await expect(page.getByRole('heading', { name: 'Кто будет снимать' })).toBeVisible();
  await expect(page.locator('.ccard').first()).toBeVisible({ timeout: 15_000 });
}

test('выбор вида ведёт на подбор, а вторая ветка — не в никуда', async ({ page }) => {
  await page.getByRole('button', { name: 'Посчитать смету' }).click();
  await expect(page).toHaveURL(/\/me\/orders\/new/);
  await expect(page.getByRole('heading', { name: 'Что делаем?' })).toBeVisible({ timeout: 15_000 });

  // Продакшена ещё нет. Нажатие обязано объяснить это на месте, а не
  // увести на пустую страницу или промолчать.
  await page.locator('.kind.k2').click();
  await expect(page).toHaveURL(/\/me\/orders\/new/);
  await expect(page.locator('.kind-soon')).toContainText('менеджера');
  await expect(page.getByRole('heading', { name: 'Кто будет снимать' })).toHaveCount(0);

  // А первая ветка ведёт в подбор, и каталог там не пустой: пустой
  // каталог — это та же дорога в никуда, только длиннее.
  await page.locator('.kind.k1').click();
  await expect(page.getByRole('heading', { name: 'Кто будет снимать' })).toBeVisible();
  await expect(page.locator('.ccard').first()).toBeVisible({ timeout: 15_000 });
});

test('смета пересчитывается на каждое изменение состава', async ({ page }) => {
  await openPicking(page);
  const cards = page.locator('.ccard:not([disabled])');
  const total = page.locator('.btot b');

  const [first] = await Promise.all([estimateCall(page), cards.nth(0).click()]);
  const firstBody = JSON.parse(first.request().postData() ?? '{}');
  expect(firstBody.creator_ids).toHaveLength(1);
  await expect(total).toHaveText(money((await first.json()).total));

  // Второй человек — новый состав и новый запрос. Стухшая смета выглядит
  // ровно как рабочая, поэтому смотрим и на запрос, и на число.
  const [second] = await Promise.all([estimateCall(page), cards.nth(1).click()]);
  const secondBody = JSON.parse(second.request().postData() ?? '{}');
  expect(secondBody.creator_ids).toHaveLength(2);
  expect(secondBody.creator_ids[0], 'состав дополняется, а не переписывается').toBe(
    firstBody.creator_ids[0],
  );
  await expect(total).toHaveText(money((await second.json()).total));

  // И на удаление тоже: убрать человека — такое же изменение состава.
  const [third] = await Promise.all([estimateCall(page), cards.nth(1).click()]);
  expect(JSON.parse(third.request().postData() ?? '{}').creator_ids).toHaveLength(1);
  await expect(total).toHaveText(money((await third.json()).total));
});

test('лимит месяца уважается, а состав уходит по приоритету', async ({ page }) => {
  const byName = await catalogByName();
  await openPicking(page);

  const cards = page.locator('.ccard:not([disabled])');
  const nameA = (await cards.nth(0).locator('.meta b').innerText()).trim();
  const nameB = (await cards.nth(1).locator('.meta b').innerText()).trim();
  const idA = byName.get(nameA);
  const idB = byName.get(nameB);
  expect(idA, `в каталоге нет ${nameA}`).toBeTruthy();
  expect(idB, `в каталоге нет ${nameB}`).toBeTruthy();

  await Promise.all([estimateCall(page), cards.nth(0).click()]);
  await Promise.all([estimateCall(page), cards.nth(1).click()]);

  // В первый месяц доступен один креатор. Второй не пропадает и не
  // молчит — он уходит в резерв, и подсказка объясняет, почему.
  const allowed = Number((await page.locator('.zone').first().innerText()).replace(/\D+/g, ''));
  expect(allowed, 'лимит первого месяца — один креатор').toBe(1);
  await expect(page.locator('.reserve-zone')).toBeVisible();
  await expect(page.locator('.reserve-hint')).toContainText('в резерве');
  expect(await page.locator('.brow').count(), 'в подборке оба').toBe(2);

  // Приоритет — это порядок строк, а не порядок кликов: поднимаем
  // второго над первым.
  await page
    .locator('.brow.reserve')
    .getByRole('button', { name: `Выше: ${nameB}` })
    .click();
  await expect(page.locator('.brow').first()).toContainText(nameB);

  const consent = page.locator('.consent input');
  if (await consent.isEnabled()) await consent.check();

  // Ориентир читаем, когда он посчитан: «считаем…» — это ещё не число.
  await expect(page.locator('.btot b')).not.toHaveText('считаем…');
  const draftTotal = (await page.locator('.btot b').innerText()).trim();

  let orderId = '';
  try {
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/me/orders') && r.request().method() === 'POST',
      ),
      page.locator('.send').click(),
    ]);
    expect(created.status(), await created.text()).toBe(201);

    const sent = JSON.parse(created.request().postData() ?? '{}');
    expect(sent.creator_ids, 'состав уходит по приоритету, а не по порядку кликов').toEqual([
      idB,
      idA,
    ]);
    expect(sent.needed, 'зовём не больше разрешённого на месяц').toBe(1);

    orderId = (await created.json()).order.id;

    // Приглашение ушло одному — тому, кто первый по приоритету. Второй
    // ждёт в резерве: место освободится отказом или молчанием.
    await expect(page.getByRole('heading', { name: 'Ждём ответы' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.inv').first()).toContainText(nameB);
    await expect(page.locator('.inv').first()).toContainText('Ждём ответа');
    await expect(page.locator('.inv').nth(1)).toContainText('В резерве');

    // Число, которое человек видел до оформления, — то же, по которому
    // ему выставят счёт.
    const api = await clientApi();
    const est = await api.get(`/api/v1/me/orders/${orderId}/estimate`);
    expect(est.ok(), await est.text()).toBeTruthy();
    const body = await est.json();
    await api.dispose();
    expect(draftTotal, 'ориентир на экране и смета заказа — одно число').toBe(money(body.total));
    expect(body.creators, 'в заказе ровно столько людей, сколько разрешил лимит').toBe(1);
  } finally {
    if (orderId) await cancelOrder(orderId);
  }
});
