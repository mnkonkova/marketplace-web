import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

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
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
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
  box = await createSandbox('phead');
});

test.afterAll(() => dropSandbox(box));

function signIn(page: Page) {
  return page
    .context()
    .addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.manager] as const,
    );
}

/**
 * Число из «Выкладок: N» в шапке.
 *
 * Рядом в той же ячейке стоит «· N отменено», поэтому вытаскиваем именно
 * первое число после подписи: «выкинуть все нецифры» склеивало два счёта
 * в одно бессмысленное.
 */
/**
 * Сколько выкладок в ленте над карточкой.
 *
 * Счётчик переехал из шапки в ленту просмотров и считает ДЕЙСТВУЮЩИЕ:
 * «29 выкладок · закрыто 2». Отдельной подписи «N отменено» больше нет —
 * отменённая выкладка не показывается нигде, и это сильнее, чем
 * показывать её отдельным числом.
 */
async function headCount(page: Page): Promise<number> {
  const meta = page.locator('.ribbon .meta');
  const text = (await meta.textContent()) ?? '';
  return Number(/(\d+)\s+выкладк/.exec(text.replace(/\u00a0/g, ' '))?.[1] ?? NaN);
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
    // До: сколько действующих выкладок в проекте сейчас.
    await page.goto(`/manager/projects/${box.projectId}`);
    await expect(page.locator('.ribbon .meta')).toBeVisible({ timeout: 15_000 });
    const before = await headCount(page);

    // Заводим пачку на будущее и тут же снимаем её целиком.
    const creators = await call('get', `/api/v1/manager/projects/${box.projectId}/creators`);
    const creatorID = creators.body.items[0].user_id as string;
    const dates = ['2099-01-01', '2099-01-02', '2099-01-03'];
    const batch = await call(
      'post',
      `/api/v1/manager/projects/${box.projectId}/publications/batch`,
      {
        creator_user_ids: [creatorID],
        dates,
      },
    );
    expect(batch.status, 'пачка заведена').toBe(201);
    batchID = batch.body.batch_id as string;
    cancelled = dates.length;

    const drop = await call(
      'post',
      `/api/v1/manager/projects/${box.projectId}/publications/cancel_batch`,
      { batch_id: batchID },
    );
    expect(drop.status, 'пачка снята').toBe(200);

    await page.reload();
    await expect(page.locator('.ribbon .meta')).toBeVisible({ timeout: 15_000 });

    // Лента считает то же, что план: отменённые сняты и в счёт не идут.
    await expect
      .poll(() => headCount(page), {
        timeout: 10_000,
        message: 'отменённые не должны попадать в «Выкладок»',
      })
      .toBe(before);

    // И в самом плане их тоже нет: сетка рисует действующие выкладки, а
    // снятая исчезает из неё целиком — «отменённая клетка» была бы
    // состоянием, которого у работы не бывает.
    await expect(page.locator('.grid-plan .c.p, .grid-plan .c.d')).toHaveCount(
      await page.locator('.grid-plan .c.p, .grid-plan .c.d').count(),
    );
  });
});

test.describe('обратный отсчёт', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('о закрытой выкладке план не говорит «просрочено»', async ({ page }) => {
    await page.goto(`/manager/projects/${box.projectId}`);

    // Вышедшая выкладка помечена в сетке своим состоянием — галочкой, а
    // не восклицательным знаком: срок к закрытой работе не относится, и
    // «просрочено» рядом с ней читается как несданное.
    const done = page.locator('.grid-plan .c.d').first();
    await expect(done, 'вышедшая выкладка нарисована в плане').toBeVisible({ timeout: 15_000 });
    await expect(done).not.toHaveClass(/\bl\b/);
    await expect(done).toHaveAttribute('title', /вышел/);
  });
});

test.describe('предоплата', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test.afterEach(async () => {
    // Платёж заводил тест — подтверждённый платёж API задним числом не
    // трогает, поэтому убираем SQL'ем.
    psql(`DELETE FROM project_payments WHERE project_id = '${box.projectId}';`);
  });

  test('работа идёт без предоплаты — предупреждаем; подтвердили — убираем', async ({ page }) => {
    psql(`DELETE FROM project_payments WHERE project_id = '${box.projectId}';`);

    await page.goto(`/manager/projects/${box.projectId}`);
    // Полоса опознаётся КЛАССОМ, а не фразой: текста в ней два разных, и
    // привязка к одному из них означала бы, что второе состояние не
    // проверяет никто.
    // Предупреждение переехало в «Где горит» — карточкой с числом:
    // менеджер начинает день с этого экрана, и полоса внизу страницы
    // отвечала на вопрос, которого он там уже не задаёт.
    const bar = page.locator('.alert').filter({ hasText: 'Предоплата' });
    await expect(bar, 'выкладки есть, предоплаты нет').toBeVisible({ timeout: 15_000 });
    await expect(bar, 'сказано, что предоплаты нет вовсе').toContainText('Предоплата не заведена');

    const set = await call('put', `/api/v1/manager/projects/${box.projectId}/payments/prepayment`, {
      amount: 10_000_000,
    });
    expect(set.status, 'сумма выставлена').toBe(200);

    await page.reload();
    await expect(bar, 'сумма есть, денег нет — предупреждение остаётся').toBeVisible({
      timeout: 15_000,
    });
    // И говорит уже ДРУГОЕ: «не заведена» и «выставлена, но не оплачена»
    // — разные дела менеджера, и одинаковый текст на них посылал бы его
    // заводить сумму, которая уже заведена.
    await expect(bar, 'счёт выставлен, деньги не пришли').toContainText(
      'Предоплата не подтверждена',
    );

    const confirm = await call(
      'post',
      `/api/v1/manager/projects/${box.projectId}/payments/prepayment/confirm`,
    );
    expect(confirm.status, 'деньги отмечены полученными').toBe(200);

    await page.reload();
    await expect(page.locator('.ribbon .meta')).toBeVisible({ timeout: 15_000 });
    await expect(bar, 'после подтверждения предупреждать не о чем').toHaveCount(0);
  });
});
