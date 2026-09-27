import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { callAs, createSandbox, dropSandbox, ym, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/**
 * Воронка «под ключ» от заявки до состава — путь троих.
 *
 * Заявка уходит рассылкой ВСЕМ известным креаторам, отвечают желающие,
 * состав из откликнувшихся собирает менеджер. Три экрана и три роли, и
 * ломается это тише всего посередине: заявка есть в базе, а креатор её
 * не видит; отклик записан, а менеджер о нём не знает. Юнит-специи
 * такого не ловят — у каждой стороны свой экран и своя ручка.
 *
 * Проверяем цепочку целиком:
 *   • креатор видит заявку, хотя лично его никто не звал, — и видит
 *     отметку «хотят особенно», если заказчик его отметил;
 *   • отклик «из моих роликов» доезжает до менеджера с работой, а не
 *     голым «согласен»;
 *   • «Взять в проект» ставит человека в состав, и второй раз кнопку
 *     уже не предлагают.
 */
let box: Sandbox;

/** Заказ и проект живут ровно эту спеку. */
let orderId = '';

let itemId = '';

test.beforeAll(async () => {
  // Двое своих креаторов: первый уже в составе (его кладёт песочница),
  // второй свободен — на нём и проверяем путь «откликнулся → взяли».
  box = await createSandbox(`turnkey${String(Date.now()).slice(-5)}`, {
    shape: 'empty',
    ownClient: true,
    ownCreator: true,
    inCatalog: true,
    creators: 2,
  });

  // Заявка заказчика. Отмечен ВТОРОЙ креатор: он не в составе, и по
  // нему видно и отметку «хотят особенно», и путь до состава.
  await callAs(box.client, 'post', '/api/v1/me/orders/terms/consent');
  const created = await callAs(
    box.client,
    'post',
    '/api/v1/me/orders',
    {
      start_month: ym(),
      needed: 1,
      videos_count: 30,
      creator_ids: [box.creators[1].userId],
      brief: { product: 'кофе на подписку', goal: 'продажи' },
      ceiling: 5_000_000,
    },
    [201],
  );
  orderId = created.order.id as string;

  // Заявка завела свой проект — он нам не нужен: менеджер песочницы
  // видит только свои проекты, и состав мы собираем в его. Ставим
  // заказу проект песочницы, а лишний убираем.
  const spare = created.order.project_id as string | undefined;
  psql(`UPDATE creator_orders SET project_id = '${box.projectId}' WHERE id = '${orderId}';`);
  if (spare) psql(`DELETE FROM projects WHERE id = '${spare}';`);

  // Ролик в портфолио — чтобы было чем ответить «из моих». Номер
  // задаём сами: psql из фикстур ничего не возвращает, а убрать за
  // собой строку надо по точному id, не по «последней добавленной».
  itemId = randomUUID();
  psql(`
INSERT INTO portfolio_items (id, user_id, kind, title, video_url)
VALUES ('${itemId}', '${box.creators[1].userId}', 'video', 'Ролик про кофе',
        'https://cdn.example/portfolio/coffee.mp4');`);
});

test.afterAll(() => {
  if (orderId) {
    psql(`DELETE FROM notification_log WHERE subject_id = '${orderId}';`);
    psql(`DELETE FROM creator_orders WHERE id = '${orderId}';`);
  }
  if (itemId) psql(`DELETE FROM portfolio_items WHERE id = '${itemId}';`);
  dropSandbox(box);
});

function signIn(page: Page, session: unknown) {
  return page
    .context()
    .addInitScript(([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)), [
      AUTH_KEY,
      session,
    ] as const);
}

test('креатор видит заявку и отвечает своими роликами, менеджер берёт его в проект', async ({
  page,
}) => {
  // ── креатор ────────────────────────────────────────────────────
  await signIn(page, box.creators[1].session);
  await page.goto('/me/creator/invitations');

  const card = page.locator('.inv-card', { hasText: 'кофе на подписку' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  // Отметку заказчика видно: это единственное, что он о людях сказал.
  await expect(card.getByText('хотят особенно вас')).toBeVisible();

  await card.getByRole('button', { name: 'Ответить' }).click();
  await card.getByRole('button', { name: /Отправить из моих/ }).click();

  const tile = card.locator('.pf-item').first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await tile.click();

  const [respond] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/invitations/') && r.request().method() === 'POST',
    ),
    card.getByRole('button', { name: 'Отправить выбранное' }).click(),
  ]);
  expect(respond.status(), await respond.text()).toBe(200);

  // Ответ виден на месте: человек должен знать, что отклик ушёл.
  await expect(card.getByText('вы показали свои ролики')).toBeVisible({ timeout: 10_000 });

  // ── менеджер ───────────────────────────────────────────────────
  await page.context().clearCookies();
  await page
    .context()
    .addInitScript(([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)), [
      AUTH_KEY,
      box.sessions.manager,
    ] as const);
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Креаторы');

  const responses = page.locator('.panel', { hasText: 'Согласны на заявку' });
  await expect(responses).toBeVisible({ timeout: 20_000 });
  const row = responses.locator('.rnk', { hasText: box.creators[1].name });
  await expect(row).toBeVisible();
  // С работой, а не голым «согласен»: менеджеру есть что открыть.
  await expect(row.getByRole('link', { name: 'Ролик про кофе' })).toBeVisible();

  const [finalize] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/finalize') && r.request().method() === 'POST'),
    row.getByRole('button', { name: 'Взять в проект' }).click(),
  ]);
  expect(finalize.status(), await finalize.text()).toBe(200);

  // Второй раз брать некого: строка говорит «в составе», кнопки нет.
  await expect(row.getByText('в составе')).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole('button', { name: 'Взять в проект' })).toHaveCount(0);

  // И человек действительно в составе проекта, а не только в списке
  // откликов: состав — это то, по чему считают деньги и ставят даты.
  await expect(page.locator('.sec-team').getByText(box.creators[1].name).first()).toBeVisible();
});
