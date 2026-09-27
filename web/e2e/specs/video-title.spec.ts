import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openCreatorTab } from '../fixtures/ui';

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
  box = await createSandbox('vtitle');
});

test.afterAll(() => dropSandbox(box));

async function managerApi() {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
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
  const api = await managerApi();
  const crew = await api.get(`/api/v1/manager/projects/${box.projectId}/creators`);
  const creatorId = (await crew.json()).items[0].user_id as string;
  const due = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const res = await api.post(`/api/v1/manager/projects/${box.projectId}/publications/batch`, {
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
    [AUTH_KEY, box.sessions[role]] as const,
  );

test('креатор называет ролик, и название видят менеджер и заказчик', async ({
  browser,
  context,
  page,
}) => {
  const batchId = await seedOpenPublication(2);
  try {
    await signIn(context, 'creator');
    await page.goto(`/me/creator/projects/${box.projectId}`);

    await page
      .locator('.posts2')
      .getByRole('button', { name: 'Сдать', exact: true })
      .first()
      .click();
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

    // Обязательные пункты чеклиста отмечает сдающий: без них кнопка
    // гашена, а сервер отвечает 422. Отмечаем ровно обязательные —
    // остальные и должны остаться пустыми.
    const required = modal.locator('label.ck').filter({ hasText: 'обязательно' });
    for (let i = 0; i < (await required.count()); i += 1) {
      const item = required.nth(i);
      if (!(await item.evaluate((el) => el.classList.contains('on')))) await item.click();
    }

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/links') && r.request().method() === 'POST'),
      modal.getByRole('button', { name: 'Сдать' }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).title, 'название уходит вместе со ссылками').toBe(TITLE);

    // Креатор видит его вместо номера выкладки — в своём разделе
    // выкладок: список кабинета ушёл под вкладку.
    await openCreatorTab(page, 'Мои выкладки');
    await expect(page.locator('.posts2 .row').filter({ hasText: TITLE })).toHaveCount(1);

    // И то, ради чего название вообще заводили: менеджер видит его в
    // плане, а заказчик — в ленте роликов. Проверка на стороне креатора
    // без этого стерегла бы только его собственный экран.
    const asManager = await browser.newContext();
    try {
      await signIn(asManager, 'manager');
      const mgr = await asManager.newPage();
      await mgr.goto(`/manager/projects/${box.projectId}`);
      // У менеджера название стоит в «Ссылках на ролики»: в сетке плана
      // клетка отвечает за состояние, а не за подпись. Список свёрнут
      // по людям — разворачиваем своего.
      const links = mgr.locator('.sec-links');
      await links
        .getByRole('button', { name: new RegExp(box.creator.name) })
        .first()
        .click();
      await expect(links.getByText(TITLE)).toHaveCount(1, { timeout: 15_000 });
    } finally {
      await asManager.close();
    }

    const asClient = await browser.newContext();
    try {
      await signIn(asClient, 'client');
      const cli = await asClient.newPage();
      await cli.goto(`/me/projects/${box.projectId}`);
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
    // Первая сдача — с названием, через API: тут важна вторая.
    const creatorApi = await pwRequest.newContext({
      baseURL: API,
      extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.creator.access_token}` },
    });
    const list = await creatorApi.get(`/api/v1/me/creator/projects/${box.projectId}/publications`);
    const open = ((await list.json()).items as any[]).find((p) => p.status === 'planned');
    // Обязательные пункты чеклиста отмечает сдающий: без них сервер
    // отвечает 422, и первая сдача просто не состоялась бы.
    const chk = await creatorApi.get(`/api/v1/me/creator/projects/${box.projectId}/checklist`);
    const required = ((await chk.json()).items as any[])
      .filter((i) => i.is_required)
      .map((i) => i.id);
    await creatorApi.post(`/api/v1/me/creator/publications/${open.id}/links`, {
      data: {
        urls: [`https://www.tiktok.com/@nastya/video/${Date.now()}`],
        title: TITLE,
        checked_item_ids: required,
      },
    });
    await creatorApi.dispose();

    await signIn(context, 'creator');
    await page.goto(`/me/creator/projects/${box.projectId}`);

    // Второй заход: поле подставлено, а не пустое.
    await page
      .getByRole('button', { name: /^(Сдать|Ссылки)$/ })
      .first()
      .click();
    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByPlaceholder('Например')).toHaveValue(TITLE);
  } finally {
    dropBatch(batchId);
  }
});
