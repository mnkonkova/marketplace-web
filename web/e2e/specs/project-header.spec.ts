import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { AUTH_KEY, psql, world } from '../fixtures/world';

/**
 * Шапка проекта у менеджера говорит то же, что план.
 *
 * Три места на одном экране считали выкладки по-разному: «Выкладок: 10» в
 * шапке, «10» на вкладке и «Закрыто 1 из 1, отменённых скрыто: 9» в самом
 * плане. Отменённые из плана скрыты намеренно — значит и счётчики должны
 * считать так же. Плюс два состояния шапки, которые видно только на живых
 * данных: обратный отсчёт у закрытой выкладки и предупреждение о
 * предоплате.
 *
 * Мир переиспользуется между прогонами, поэтому всё заведённое здесь
 * убирается за собой: отменённые строки — SQL'ем по batch_id, платёж —
 * по проекту. Иначе следующий прогон считает чужой мусор.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

/**
 * Один запрос — один контекст.
 *
 * Держать APIRequestContext открытым, пока страница ходит по ссылкам,
 * нельзя: трассировки двух контекстов пишутся в один каталог артефактов и
 * спотыкаются друг о друга — падение выглядит как ENOENT в dispose(), а
 * не как ошибка теста.
 */
async function call(
  method: 'get' | 'post' | 'put',
  path: string,
  data?: unknown,
): Promise<{ status: number; body: any }> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.manager.access_token}` },
  });
  try {
    const res = await api[method](path, { data: data ?? undefined });
    const status = res.status();
    const body = status === 204 ? null : await res.json().catch(() => null);
    return { status, body };
  } finally {
    await api.dispose();
  }
}

function signIn(page: Page) {
  return page
    .context()
    .addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, world().sessions.manager] as const,
    );
}

/**
 * Число из «Выкладок: N» в шапке.
 *
 * Рядом в той же ячейке стоит «· N отменено», поэтому вытаскиваем именно
 * первое число после подписи: «выкинуть все нецифры» склеивало два счёта
 * в одно бессмысленное.
 */
async function headCount(page: Page): Promise<number> {
  const meta = page.locator('.phead .meta span', { hasText: 'Выкладок:' });
  const text = (await meta.textContent()) ?? '';
  return Number(/Выкладок:\s*(\d+)/.exec(text)?.[1] ?? NaN);
}

/** «· N отменено» из той же ячейки. Нет подписи — значит нет и отменённых. */
async function cancelledCount(page: Page): Promise<number> {
  const meta = page.locator('.phead .meta span', { hasText: 'Выкладок:' });
  const text = (await meta.textContent()) ?? '';
  return Number(/·\s*(\d+)\s*отменено/.exec(text)?.[1] ?? 0);
}

test.describe('счётчики выкладок', () => {
  let batchID = '';
  let cancelled = 0;

  test.beforeEach(async ({ page }) => signIn(page));

  test.afterEach(async () => {
    if (!batchID) return;
    // Отменённые строки живут в проекте вечно: ручки удаления у них нет и
    // быть не должно. Здесь их заводил тест — он их и уносит.
    psql(`DELETE FROM project_publications WHERE created_batch_id = '${batchID}';`);
    batchID = '';
  });

  test('отменённая пачка не попадает ни в шапку, ни в бейдж вкладки', async ({ page }) => {
    const w = world();

    // До: сколько действующих выкладок в проекте сейчас.
    await page.goto(`/manager/projects/${w.projectId}`);
    await expect(page.locator('.phead .meta')).toBeVisible({ timeout: 15_000 });
    const before = await headCount(page);
    const cancelledBefore = await cancelledCount(page);

    // Заводим пачку на будущее и тут же снимаем её целиком.
    const creators = await call('get', `/api/v1/manager/projects/${w.projectId}/creators`);
    const creatorID = creators.body.items[0].user_id as string;
    const dates = ['2099-01-01', '2099-01-02', '2099-01-03'];
    const batch = await call('post', `/api/v1/manager/projects/${w.projectId}/publications/batch`, {
      creator_user_ids: [creatorID],
      dates,
    });
    expect(batch.status, 'пачка заведена').toBe(201);
    batchID = batch.body.batch_id as string;
    cancelled = dates.length;

    const drop = await call(
      'post',
      `/api/v1/manager/projects/${w.projectId}/publications/cancel_batch`,
      { batch_id: batchID },
    );
    expect(drop.status, 'пачка снята').toBe(200);

    await page.reload();
    await expect(page.locator('.phead .meta')).toBeVisible({ timeout: 15_000 });

    // Шапка считает то же, что план: отменённые сняты и в счёт не идут.
    await expect
      .poll(() => headCount(page), {
        timeout: 10_000,
        message: 'отменённые не должны попадать в «Выкладок»',
      })
      .toBe(before);

    // Бейдж вкладки — то же число, а не общее количество строк в базе.
    const badge = page.locator('.tabs .tab', { hasText: 'План выкладок' }).locator('.cnt');
    await expect(badge).toHaveText(String(before));

    // И само число отменённых показано отдельно, а не спрятано. Сравниваем
    // с тем, что было: в проекте могли остаться отменённые от соседей.
    await expect
      .poll(() => cancelledCount(page), {
        timeout: 10_000,
        message: 'отменённые должны быть видны отдельной подписью',
      })
      .toBe(cancelledBefore + cancelled);
  });
});

test.describe('обратный отсчёт', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('у закрытой выкладки в плане только дата, без «−N дней»', async ({ page }) => {
    const w = world();
    await page.goto(`/manager/projects/${w.projectId}`);

    // Посеянная выкладка сдана на все пять площадок — у неё в счётчике 5/5.
    const slot = page.locator('.slot').filter({ hasText: '5/5' }).first();
    await expect(slot).toBeVisible({ timeout: 15_000 });

    const due = slot.locator('.dt .v').last();
    // Ровно дата, ничего кроме: срок к закрытой выкладке не относится, и
    // «сегодня» или «−1 день» рядом с ней читаются как несданная работа.
    await expect(due).toHaveText(/^\s*\d{2}\.\d{2}\s*$/);
  });
});

test.describe('предоплата', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test.afterEach(async () => {
    // Платёж заводил тест — подтверждённый платёж API задним числом не
    // трогает, поэтому убираем SQL'ем.
    psql(`DELETE FROM project_payments WHERE project_id = '${world().projectId}';`);
  });

  test('работа идёт без предоплаты — предупреждаем; подтвердили — убираем', async ({ page }) => {
    const w = world();
    psql(`DELETE FROM project_payments WHERE project_id = '${w.projectId}';`);

    await page.goto(`/manager/projects/${w.projectId}`);
    const bar = page.locator('.riskbar', { hasText: 'предоплата не подтверждена' });
    await expect(bar, 'выкладки есть, предоплаты нет').toBeVisible({ timeout: 15_000 });

    const set = await call('put', `/api/v1/manager/projects/${w.projectId}/payments/prepayment`, {
      amount: 10_000_000,
    });
    expect(set.status, 'сумма выставлена').toBe(200);

    await page.reload();
    await expect(bar, 'сумма есть, денег нет — предупреждение остаётся').toBeVisible({
      timeout: 15_000,
    });

    const confirm = await call(
      'post',
      `/api/v1/manager/projects/${w.projectId}/payments/prepayment/confirm`,
    );
    expect(confirm.status, 'деньги отмечены полученными').toBe(200);

    await page.reload();
    await expect(page.locator('.phead .meta')).toBeVisible({ timeout: 15_000 });
    await expect(bar, 'после подтверждения предупреждать не о чем').toBeHidden();
  });
});
