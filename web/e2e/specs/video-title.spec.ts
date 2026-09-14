import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql, world } from '../fixtures/world';

/**
 * Название ролика даёт креатор при сдаче.
 *
 * Тему выкладки задаёт дата, и до съёмки названия нет. После — оно
 * единственное, по чему ролик отличают: у менеджера в плане и у
 * заказчика в ленте иначе двенадцать одинаковых строк «Выкладка 07».
 * Поэтому проверяем весь путь целиком: креатор вписал — менеджер и
 * заказчик увидели. Промежуточные проверки («поле есть», «запрос ушёл»)
 * тут ничего не стерегут.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';
const TITLE = `Распаковка корма ${Date.now()}`;

async function managerApi() {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.manager.access_token}` },
  });
}

/**
 * Открытая выкладка на свободный день — её и сдадим.
 *
 * День у каждого теста свой: на пару «креатор + день» приходится одна
 * выкладка, и второй тест на ту же дату молча получил бы пустоту вместо
 * своей строки.
 */
async function seedOpenPublication(daysAhead: number): Promise<string> {
  const w = world();
  const api = await managerApi();
  const crew = await api.get(`/api/v1/manager/projects/${w.projectId}/creators`);
  const creatorId = (await crew.json()).items[0].user_id as string;
  const due = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const res = await api.post(`/api/v1/manager/projects/${w.projectId}/publications/batch`, {
    data: { creator_user_ids: [creatorId], dates: [due] },
  });
  const batchId = (await res.json()).batch_id as string;
  await api.dispose();
  return batchId;
}

/**
 * Убрать пачку вместе со сданным.
 *
 * Штатная отмена снимает только то, по чему ничего не сдали, — в этом и
 * смысл правила. Но тест как раз сдаёт, и его строка осталась бы в
 * проекте навсегда, а вместе с ней и название в ленте заказчика.
 * Поэтому чистим прямо в базе: это локальный стенд, и убирать за собой
 * важнее, чем ходить только через API.
 */
function dropBatch(batchId: string): void {
  psql(`
DELETE FROM video_stat_daily WHERE link_id IN (
  SELECT l.id FROM publication_links l
  JOIN project_publications p ON p.id = l.publication_id
  WHERE p.created_batch_id = '${batchId}');
DELETE FROM publication_links WHERE publication_id IN (
  SELECT id FROM project_publications WHERE created_batch_id = '${batchId}');
DELETE FROM project_publications WHERE created_batch_id = '${batchId}';
`);
}

const signIn = (
  context: import('@playwright/test').BrowserContext,
  role: 'creator' | 'manager' | 'client',
) =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

test('креатор называет ролик, и название видят менеджер и заказчик', async ({
  browser,
  context,
  page,
}) => {
  const batchId = await seedOpenPublication(2);
  try {
    await signIn(context, 'creator');
    await page.goto(`/me/creator/projects/${world().projectId}`);

    await page.getByRole('button', { name: 'Сдать ролик' }).first().click();
    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await modal.getByPlaceholder('Например').fill(TITLE);
    // Берём первое свободное поле, а не «Ссылка на TikTok»: сданные
    // площадки поля не показывают, и привязка к конкретной делает тест
    // зависимым от того, что уже сдано.
    await modal
      .locator('input[type="url"]')
      .first()
      .fill(`https://www.tiktok.com/@nastya/video/${Date.now()}`);

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/links') && r.request().method() === 'POST'),
      modal.getByRole('button', { name: 'Сдать' }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).title, 'название уходит вместе со ссылками').toBe(TITLE);

    // Креатор видит его вместо номера выкладки.
    await expect(page.locator('.slotcard').filter({ hasText: TITLE })).toHaveCount(1);

    // И то, ради чего название вообще заводили: менеджер видит его в
    // плане, а заказчик — в ленте роликов. Проверка на стороне креатора
    // без этого стерегла бы только его собственный экран.
    const asManager = await browser.newContext();
    try {
      await signIn(asManager, 'manager');
      const mgr = await asManager.newPage();
      await mgr.goto(`/manager/projects/${world().projectId}`);
      await expect(mgr.locator('.slot').filter({ hasText: TITLE })).toHaveCount(1, {
        timeout: 15_000,
      });
    } finally {
      await asManager.close();
    }

    const asClient = await browser.newContext();
    try {
      await signIn(asClient, 'client');
      const cli = await asClient.newPage();
      await cli.goto(`/me/projects/${world().projectId}`);
      await expect(cli.getByText(TITLE)).toBeVisible({ timeout: 15_000 });
    } finally {
      await asClient.close();
    }
  } finally {
    dropBatch(batchId);
  }
});

test('досылая площадки, название не приходится вписывать заново', async ({ context, page }) => {
  const batchId = await seedOpenPublication(4);
  try {
    const w = world();
    // Первая сдача — с названием, через API: тут важна вторая.
    const creatorApi = await pwRequest.newContext({
      baseURL: API,
      extraHTTPHeaders: { Authorization: `Bearer ${w.sessions.creator.access_token}` },
    });
    const list = await creatorApi.get(`/api/v1/me/creator/projects/${w.projectId}/publications`);
    const open = ((await list.json()).items as any[]).find((p) => p.status === 'planned');
    await creatorApi.post(`/api/v1/me/creator/publications/${open.id}/links`, {
      data: { urls: [`https://www.tiktok.com/@nastya/video/${Date.now()}`], title: TITLE },
    });
    await creatorApi.dispose();

    await signIn(context, 'creator');
    await page.goto(`/me/creator/projects/${w.projectId}`);

    // Второй заход: поле подставлено, а не пустое.
    await page
      .getByRole('button', { name: /Дослать ссылки|Сдать ролик/ })
      .first()
      .click();
    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByPlaceholder('Например')).toHaveValue(TITLE);
  } finally {
    dropBatch(batchId);
  }
});
