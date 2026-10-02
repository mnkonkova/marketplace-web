import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * «Сдать ролик» у креатора.
 *
 * Окно собрано из словаря макета (.ovl / .modal), и пока этих правил не
 * было в стилях, разметка не переставала работать — она переставала быть
 * окном: блок утекал в конец страницы без подложки и центрирования.
 * Нажатие выглядело как «кнопка никуда не ведёт», хотя обработчик
 * отрабатывал. Поэтому проверяем не «модалка в DOM», а что она видна и
 * лежит поверх страницы.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

/** Открытая выкладка на послезавтра — сдавать её и будем. */
async function seedOpenPublication(): Promise<string> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
  });
  const crew = await api.get(`/api/v1/manager/projects/${box.projectId}/creators`);
  const creatorId = (await crew.json()).items[0].user_id as string;
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const res = await api.post(`/api/v1/manager/projects/${box.projectId}/publications/batch`, {
    data: { creator_user_ids: [creatorId], dates: [due] },
  });
  const body = await res.json();
  await api.dispose();
  return body.batch_id as string;
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
  box = await createSandbox('submit');
});

test.afterAll(() => dropSandbox(box));

/**
 * Отметить пункты чеклиста в окне сдачи.
 *
 * Без обязательных пунктов кнопка «Сдать» выключена — это и есть смысл
 * чеклиста. Тест отмечает всё: он про пересдачу ссылок, а не про то,
 * какие пункты обязательны.
 */
async function tickChecklist(modal: import('@playwright/test').Locator): Promise<void> {
  const boxes = modal.locator('label.ck');
  for (let i = 0; i < (await boxes.count()); i += 1) await boxes.nth(i).click();
}

async function dropBatch(batchId: string): Promise<void> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
  });
  await api.post(`/api/v1/manager/projects/${box.projectId}/publications/cancel_batch`, {
    data: { batch_id: batchId },
  });
  await api.dispose();
}

test('окно сдачи открывается поверх страницы', async ({ context, page }) => {
  const batchId = await seedOpenPublication();
  try {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.creator] as const,
    );
    await page.goto(`/me/creator/projects/${box.projectId}`);

    const submit = page
      .locator('.posts-stack')
      .getByRole('button', { name: 'Сдать', exact: true })
      .first();
    await expect(submit, 'у открытой выкладки есть чем сдать').toBeVisible({ timeout: 15_000 });
    await submit.click();

    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    await expect(modal).toBeVisible();

    // Окно, а не блок в конце страницы: подложка на весь экран и
    // позиционирование fixed.
    const overlay = page.locator('.ovl.on');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('position', 'fixed');

    // Поля под все пять площадок — сдать можно не все сразу.
    await expect(modal.locator('input[type="url"]')).toHaveCount(5);

    // И закрывается.
    await modal.getByRole('button', { name: 'Отмена' }).click();
    await expect(modal).toBeHidden();
  } finally {
    await dropBatch(batchId);
  }
});

/**
 * Пересдача: те же ссылки можно.
 *
 * Ролик возвращают на доработку чаще, чем кажется: не та обложка, нет
 * ссылки в шапке, звук не тот. Исправляет это креатор НА ПЛОЩАДКЕ, а
 * адрес ролика при этом не меняется — значит сдать надо ровно те же
 * ссылки. Если бы сервис на это отвечал «такая ссылка уже сдана», выход
 * был бы один: перезаливать ролик и терять набранные просмотры.
 *
 * Здесь проверяется весь путь глазами креатора: сдал, вернули, сдал те
 * же адреса — принято.
 */
test('пересдать можно теми же ссылками', async ({ context, page }) => {
  const batchId = await seedOpenPublication();
  const url = 'https://www.tiktok.com/@nastya/video/7788991122334455';
  try {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.creator] as const,
    );
    await page.goto(`/me/creator/projects/${box.projectId}`);

    // 1. Сдача.
    const submit = page
      .locator('.posts-stack')
      .getByRole('button', { name: 'Сдать', exact: true })
      .first();
    await expect(submit).toBeVisible({ timeout: 15_000 });
    await submit.click();
    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    // Поле именно TikTok: порядок площадок в окне свой, и «первое
    // поле» — это Reels. Сервер площадку определяет по самой ссылке, но
    // при пересдаче адрес подставляется в поле СВОЕЙ площадки, и
    // проверять надо его.
    await modal.getByPlaceholder(/TikTok/i).fill(url);
    await tickChecklist(modal);
    const [first] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/links') && r.request().method() === 'POST'),
      modal.getByRole('button', { name: 'Сдать', exact: true }).click(),
    ]);
    expect(first.status(), await first.text()).toBe(200);

    // Ровно та выкладка, которую сдали: в песочнице есть и посеянная, с
    // пятью площадками, и возврат по ней увёл бы проверку совсем не туда.
    const api = await pwRequest.newContext({
      baseURL: API,
      extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.manager.access_token}` },
    });
    const list = await api.get(`/api/v1/manager/projects/${box.projectId}/publications`);
    const pubs = (await list.json()).items as { id: string; links: { url: string }[] }[];
    const pubId = pubs.find((p) => p.links.some((l) => l.url === url))!.id;
    await api.dispose();

    // Очередь проверки идёт по времени сдачи, и первым в ней лежит
    // посеянный ролик песочницы. Состариваем нашу сдачу, чтобы менеджеру
    // открылась именно она: проверяем возврат РУКАМИ, а не запросом.
    psql(`UPDATE publication_links SET submitted_at = now() - interval '10 days'
          WHERE publication_id = '${pubId}';`);

    // 2. Менеджер возвращает на доработку — своей кнопкой, своим экраном.
    const mgrCtx = await page.context().browser()!.newContext();
    await mgrCtx.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.manager] as const,
    );
    const mgr = await mgrCtx.newPage();
    await mgr.goto(`/manager/projects/${box.projectId}`);
    const tab = mgr.locator('.secnav').getByRole('button', { name: /Проверка/ });
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await tab.click();

    const review = mgr.locator('app-project-review');
    await expect(review, 'на проверке открыт наш ролик').toContainText(url);
    await review.locator('textarea').fill('нет ссылки в шапке профиля');
    const [back] = await Promise.all([
      mgr.waitForResponse((r) => r.url().includes('/review') && r.request().method() === 'POST'),
      review.getByRole('button', { name: 'Вернуть с замечанием' }).click(),
    ]);
    expect(back.status(), await back.text()).toBe(200);

    // 3. Возвращённый ролик проверки больше не ждёт: мяч у креатора.
    //    Запоминаем счётчик, чтобы потом увидеть, как он вернётся.
    await mgr.reload();
    await expect(tab).toBeVisible({ timeout: 20_000 });
    const before = Number((await tab.locator('.secnav-badge').textContent()) || 0);

    // 4. Креатор видит возврат и жмёт «Пересдать».
    //
    // Это и есть путь пересдачи: замечание менеджера стоит первым делом
    // в разделе выкладок, и кнопка — прямо под ним. Искать свою строку
    // в общем списке креатору не приходится.
    await page.reload();
    const returned = page.locator('.alert.ret').filter({ hasText: 'нет ссылки в шапке профиля' });
    await expect(returned, 'возврат виден креатору вместе с замечанием').toBeVisible({
      timeout: 15_000,
    });
    const [second] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/resubmit') && r.request().method() === 'POST'),
      returned.getByRole('button', { name: 'Исправил — проверьте' }).click(),
    ]);
    expect(second.status(), await second.text()).toBe(200);

    // Ссылка осталась та же — её не трогали. Перезаливать ролик ради
    // нового адреса значило бы потерять набранные просмотры.
    const after = await second.json();
    expect(after.id).toBe(pubId);
    expect(after.links.map((l: { url: string }) => l.url)).toEqual([url]);
    expect(after.review.status).toBe('in_review');
    expect(after.review.round, 'второй круг проверки').toBe(2);

    // И возврат с экрана ушёл: ролик снова у менеджера.
    await expect(page.locator('.alert.ret')).toHaveCount(0);

    // 5. «Снова у менеджера» — не фигура речи, а ЧУЖОЙ экран.
    //
    // Пересдача без ссылок меняет только состояние проверки. Если бы
    // кабинет менеджера её не подхватил, креатор нажал бы кнопку,
    // успокоился, а ролик остался бы лежать невидимым — худший исход из
    // возможных: обе стороны уверены, что мяч у другой.
    await mgr.reload();
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await expect(tab.locator('.secnav-badge'), 'ролик вернулся в очередь проверки').toHaveText(
      String(before + 1),
    );
    await mgrCtx.close();
  } finally {
    await dropBatch(batchId);
  }
});
