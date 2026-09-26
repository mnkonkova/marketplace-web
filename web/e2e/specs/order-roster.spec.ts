import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { callAs, createSandbox, dropSandbox, ym, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

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
 *
 * Всё — на своих людях. Раньше подборка бралась из общего каталога, и
 * три теста отсюда падали с `creator_busy`: обход кнопок нажимал у
 * общего креатора «Занят в этом месяце», и заказ переставал собираться.
 * Падала эта спека, а ломала другая — связь по отчёту не видна вовсе.
 * Занятость — отметка человека (`creator_availability`), не свойство
 * проекта, поэтому изолировать надо человека. Отказом она быть
 * перестала: заявку принимаем и предупреждаем менеджера — решать, брать
 * ли человека, всё равно ему.
 */

let box: Sandbox;

/** Заказ, привязанный к проекту песочницы, и всё, что о нём нужно знать. */
interface Seeded {
  orderId: string;
  /** Имена в порядке приоритета — их и должна показать очередь. */
  names: string[];
}

let seeded: Seeded | null = null;

/**
 * Завести заказ и привязать его к проекту песочницы.
 *
 * Заказ создаётся настоящим клиентским запросом — тем же, что шлёт
 * воронка. Приглашения намеренно НЕ отправляем: черновик — это то самое
 * состояние, когда очередь стоит, а место свободно, и двинуть её может
 * только менеджер.
 *
 * Первым по приоритету ставим первого креатора песочницы: только за него
 * тест может ответить отказом, а отказ — половина проверяемого здесь.
 */
async function seedOrder(): Promise<Seeded> {
  // Условия принимаются один раз; повторное согласие безвредно.
  await callAs(box.client, 'post', '/api/v1/me/orders/terms/consent');

  const order = await callAs(
    box.client,
    'post',
    '/api/v1/me/orders',
    {
      start_month: ym(),
      needed: 1,
      videos_count: 30,
      creator_ids: box.creators.map((c) => c.userId),
    },
    [201],
  );
  const orderId = order.order.id as string;

  // Связь «заказ → проект» ставится внутри, HTTP-ручки для неё нет.
  psql(`UPDATE creator_orders SET project_id = '${box.projectId}' WHERE id = '${orderId}';`);

  return { orderId, names: box.creators.map((c) => c.name) };
}

test.beforeAll(async () => {
  // Трое своих креаторов: один в состав, двое в резерв. Проект пустой —
  // очередь проверяется до того, как кто-то в него попал.
  box = await createSandbox(`roster${String(Date.now()).slice(-5)}`, {
    shape: 'empty',
    ownCreator: true,
    ownClient: true,
    inCatalog: true,
    creators: 3,
  });
});

// afterAll, а не finally в теле: он отрабатывает и когда тест упал на
// первой же строке.
test.afterAll(() => dropSandbox(box));

test.describe('очередь на экране', () => {
  test.beforeEach(async ({ context, page }) => {
    seeded = await seedOrder();
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.manager] as const,
    );
    await page.goto(`/manager/projects/${box.projectId}`);
  });

  test.afterEach(async () => {
    if (!seeded) return;
    await callAs(
      box.client,
      'post',
      `/api/v1/me/orders/${seeded.orderId}/cancel`,
      undefined,
      [200, 409],
    );
    psql(`UPDATE creator_orders SET project_id = NULL WHERE id = '${seeded.orderId}';`);
    seeded = null;
  });

  /** Открыть вкладку «Креаторы» и дождаться карточки очереди. */
  async function openCrew(page: Page): Promise<void> {
    await openManagerTab(page, 'Креаторы');
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
    await callAs(box.manager, 'post', `/api/v1/manager/orders/${seeded!.orderId}/invite`);
    await callAs(
      box.creators[0],
      'post',
      `/api/v1/me/creator/invitations/${seeded!.orderId}/respond`,
      { accept: false },
    );

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
});

/**
 * И то самое правило, из-за которого спека годами падала по чужой вине.
 *
 * `creator_busy` не выводится из выкладок и не зависит от проекта: это
 * отметка человека в `creator_availability`, которую он ставит сам
 * тумблером в своём кабинете. Проверяем её тем же запросом, что шлёт
 * тумблер, — и на своём человеке, чтобы отметка никому больше не
 * досталась.
 */
test('про отмеченного занятым предупреждают, но заявку принимают', async () => {
  const busy = box.creators[0];
  await callAs(busy, 'put', '/api/v1/me/creator/availability', {
    month: ym(),
    available: false,
  });
  try {
    await callAs(box.client, 'post', '/api/v1/me/orders/terms/consent');
    const res = await callAs(
      box.client,
      'post',
      '/api/v1/me/orders',
      {
        start_month: ym(),
        needed: 1,
        videos_count: 30,
        creator_ids: box.creators.map((c) => c.userId),
      },
      [201],
    );
    // Занятость — ПРЕДУПРЕЖДЕНИЕ, а не отказ: приглашение всё равно
    // уйдёт, и решать будет он сам. Отказать в заявке из-за чужой
    // галочки — худшее, что можно сделать на входе; раньше так и было,
    // и заявка с занятым в подборке не создавалась вовсе.
    expect(res.busy_creators, 'о занятом предупредили').toContain(busy.userId);
  } finally {
    // Возвращаем как было: следующий тест в файле собирает заказ с тем же
    // человеком, и оставленная отметка сломала бы его — ровно так, как
    // эта спека и ломалась раньше.
    await callAs(busy, 'put', '/api/v1/me/creator/availability', {
      month: ym(),
      available: true,
    });
  }
});
