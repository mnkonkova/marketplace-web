import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { AUTH_KEY, psql, world } from '../fixtures/world';

/**
 * Очередь приглашений на менеджерском экране проекта.
 *
 * Состав проекта — это результат очереди, а не отдельный список: клиент
 * присылал ПРИОРИТЕТ, приглашения уходили сверху вниз по одному на
 * свободное место, и в проект человек попал потому, что до него дошла
 * очередь. Без этой карточки менеджер видит четвёртого по приоритету и
 * не понимает, почему не первый.
 *
 * Проверяем то, что ломается тихо:
 *   • очередь идёт по приоритету, а НЕ в том порядке, в каком её отдал
 *     сервер: перестановка строк здесь читается как «позвали не того»;
 *   • «Пригласить следующего» не предлагается, когда звать некуда —
 *     приглашение уходит только на реально свободное место, и кнопка,
 *     которая всегда отвечает 409, хуже отсутствующей;
 *   • отказавшийся остаётся видимым: он и есть объяснение, почему место
 *     освободилось.
 */

const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

function ctx(role: 'client' | 'creator' | 'manager'): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions[role].access_token}` },
  });
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Заказ, привязанный к посеянному проекту, и всё, что о нём нужно знать. */
interface Seeded {
  orderId: string;
  /** Имена в порядке приоритета — их и должна показать очередь. */
  names: string[];
}

let seeded: Seeded | null = null;

/**
 * Завести заказ и привязать его к посеянному проекту.
 *
 * Заказ создаётся настоящим клиентским запросом — тем же, что шлёт
 * воронка. Приглашения намеренно НЕ отправляем: черновик — это то самое
 * состояние, когда очередь стоит, а место свободно, и двинуть её может
 * только менеджер.
 *
 * Первым по приоритету ставим посеянного креатора: только за него тест
 * может ответить отказом, а отказ — половина проверяемого здесь.
 */
async function seedOrder(): Promise<Seeded> {
  const client = await ctx('client');
  const creator = await ctx('creator');
  const anon = await pwRequest.newContext({ baseURL: API });
  try {
    const me = await (await creator.get('/api/v1/me')).json();
    const catalog = await (await anon.get('/api/v1/search?category=blogger,ugc&limit=50')).json();
    const others = (catalog.items ?? [])
      .filter((i: { user_id: string }) => i.user_id !== me.user_id)
      .slice(0, 2) as { user_id: string; display_name: string }[];
    expect(others.length, 'в каталоге нужны двое креаторов на резерв').toBe(2);

    // Условия принимаются один раз; повторное согласие безвредно.
    await client.post('/api/v1/me/orders/terms/consent');

    const res = await client.post('/api/v1/me/orders', {
      data: {
        start_month: currentMonth(),
        needed: 1,
        videos_count: 30,
        creator_ids: [me.user_id, others[0].user_id, others[1].user_id],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const orderId = (await res.json()).order.id as string;

    // Связь «заказ → проект» ставится внутри, HTTP-ручки для неё нет.
    psql(`UPDATE creator_orders SET project_id = '${world().projectId}' WHERE id = '${orderId}';`);

    return {
      orderId,
      names: [me.display_name, others[0].display_name, others[1].display_name],
    };
  } finally {
    await client.dispose();
    await creator.dispose();
    await anon.dispose();
  }
}

test.beforeEach(async ({ context, page }) => {
  seeded = await seedOrder();
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${world().projectId}`);
});

/**
 * Убрать заказ и отвязать его от проекта.
 *
 * afterEach, а не finally в теле: он отрабатывает и когда тест упал на
 * первой же строке, а посеянный проект общий — заказ, оставшийся на нём,
 * пририсует соседним специям карточку, которой они не ждут.
 */
test.afterEach(async () => {
  if (!seeded) return;
  const client = await ctx('client');
  await client.post(`/api/v1/me/orders/${seeded.orderId}/cancel`);
  await client.dispose();
  psql(`UPDATE creator_orders SET project_id = NULL WHERE id = '${seeded.orderId}';`);
  seeded = null;
});

/** Открыть вкладку «Креаторы» и дождаться карточки очереди. */
async function openCrew(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Креаторы/ }).click({ timeout: 15_000 });
  await expect(page.locator('.ranks')).toBeVisible({ timeout: 15_000 });
}

test('очередь идёт по приоритету, а не в порядке ответа сервера', async ({ page }) => {
  // Сервер отдаёт кандидатов по priority. Разворачиваем ответ, чтобы
  // проверить не сервер, а экран: порядок строк здесь — это порядок
  // приглашений, и полагаться на чужую сортировку он не должен.
  await page.route('**/manager/projects/*/order', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.candidates = [...body.candidates].reverse();
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await openCrew(page);

  const rows = page.locator('.rnk');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('.n')).toHaveText(['1', '2', '3']);
  for (const [i, name] of seeded!.names.entries()) {
    await expect(rows.nth(i), `на ${i + 1}-м месте должен стоять ${name}`).toContainText(name);
  }
});

test('пригласить следующего можно, пока место свободно, и только пока', async ({ page }) => {
  await openCrew(page);

  // Приглашения не уходили: место одно и оно свободно, в резерве трое.
  const rows = page.locator('.rnk');
  await expect(rows.nth(0)).toContainText('В резерве');
  const invite = page.getByRole('button', { name: 'Пригласить следующего' });
  await expect(invite).toBeVisible();

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/orders/') &&
        r.url().endsWith('/invite') &&
        r.request().method() === 'POST',
    ),
    invite.click(),
  ]);
  expect(res.status(), await res.text()).toBe(200);

  // Приглашение ушло ПЕРВОМУ по приоритету, а не кому попало.
  await expect(rows.nth(0)).toContainText('Ждём ответа');
  await expect(rows.nth(0)).toContainText(seeded!.names[0]);
  await expect(rows.nth(1)).toContainText('В резерве');

  // И кнопки больше нет: место занято ожиданием ответа, звать некуда.
  // Кнопка, которая с этого момента может только получить 409, хуже
  // отсутствующей.
  await expect(invite).toBeHidden();
});

test('отказавшийся остаётся в очереди, а место уходит следующему', async ({ page }) => {
  const manager = await ctx('manager');
  const creator = await ctx('creator');
  try {
    const invited = await manager.post(`/api/v1/manager/orders/${seeded!.orderId}/invite`);
    expect(invited.status(), await invited.text()).toBe(200);

    const declined = await creator.post(
      `/api/v1/me/creator/invitations/${seeded!.orderId}/respond`,
      { data: { accept: false } },
    );
    expect(declined.status(), await declined.text()).toBe(200);
  } finally {
    await manager.dispose();
    await creator.dispose();
  }

  await page.reload();
  await openCrew(page);

  const rows = page.locator('.rnk');
  await expect(rows).toHaveCount(3);
  // Отказавшегося не прячем: он и есть объяснение, почему место
  // освободилось и почему в проекте окажется второй по приоритету.
  await expect(rows.nth(0)).toContainText(seeded!.names[0]);
  await expect(rows.nth(0)).toContainText('Отказался');
  // Место ушло следующему само, без единого нажатия.
  await expect(rows.nth(1)).toContainText('Ждём ответа');
  await expect(page.getByRole('button', { name: 'Пригласить следующего' })).toBeHidden();
});
