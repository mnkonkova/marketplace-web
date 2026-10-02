import { test, expect, type Page, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Чеклист при сдаче ролика.
 *
 * Чеклист — это требования, по которым ролик примут или вернут, и
 * креатор должен видеть их в тот момент, когда сдаёт, а не узнавать
 * после отказа. Обе ветки ломаются молча и по-разному.
 *
 * Подключённый шаблон, который не нарисовался: обязательные пункты всё
 * равно гасят «Сдать», и человек видит «не отмечено обязательных
 * пунктов: 1», не имея возможности отметить хоть один. Кнопка выглядит
 * сломанной, хотя сломан показ.
 *
 * Шаблон не подключён: экран не говорит ничего, и пустое место под
 * ссылками читается как «требований нет» — ровно до первого возврата
 * «вы не сняли товар в кадре». «Чеклист к проекту не подключён» и
 * «требований нет» — разные вещи, и различить их человек должен на
 * экране, а не в переписке.
 *
 * Работаем на проекте без публикаций: свою выкладку заводим сами и за
 * собой убираем — чеклист уходит в проект снимком, и оставленный он
 * сменил бы условия соседним специям.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

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
  box = await createSandbox('chklist', { shape: 'empty' });
});

test.afterAll(() => dropSandbox(box));

const TEMPLATE = `E2E чеклист сдачи ${Date.now()}`;

async function api(role: 'manager' | 'admin' | 'creator') {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions[role].access_token}` },
  });
}

/** Открытая выкладка на послезавтра — её и будем сдавать. */
async function seedOpenPublication(projectId: string): Promise<string> {
  const manager = await api('manager');
  const crew = await manager.get(`/api/v1/manager/projects/${projectId}/creators`);
  const creatorId = (await crew.json()).items[0].user_id as string;
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const res = await manager.post(`/api/v1/manager/projects/${projectId}/publications/batch`, {
    data: { creator_user_ids: [creatorId], dates: [due] },
  });
  const batchId = (await res.json()).batch_id as string;
  await manager.dispose();
  return batchId;
}

/**
 * Убрать выкладку начисто.
 *
 * Штатная отмена снимает только то, по чему ничего не сдали, и этого
 * здесь хватило бы, — но правило может измениться, а проект без
 * публикаций обязан остаться без публикаций: на нём стоит спека про
 * «периода ещё нет».
 */
function dropBatch(batchId: string): void {
  psql(`
DELETE FROM publication_links WHERE publication_id IN (
  SELECT id FROM project_publications WHERE created_batch_id = '${batchId}');
DELETE FROM project_publications WHERE created_batch_id = '${batchId}';
`);
}

/** Подключить к проекту свежий шаблон с двумя пунктами. Возвращает его id. */
async function attachChecklist(projectId: string): Promise<string> {
  const admin = await api('admin');
  const created = await admin.post('/api/v1/admin/checklist_templates', {
    data: {
      name: TEMPLATE,
      items: [
        { text: 'Товар в кадре с первой секунды', platform: '', is_required: true },
        { text: 'Ссылка в описании', platform: '', is_required: false },
      ],
    },
  });
  const templateId = (await created.json()).id as string;
  await admin.dispose();

  const manager = await api('manager');
  const snap = await manager.post(`/api/v1/manager/projects/${projectId}/checklist`, {
    data: { template_id: templateId },
  });
  if (!snap.ok()) throw new Error(`снимок чеклиста: ${snap.status()} ${await snap.text()}`);
  await manager.dispose();
  return templateId;
}

/** Снять чеклист с проекта и убрать шаблон из библиотеки. */
async function detachChecklist(projectId: string, templateId: string): Promise<void> {
  // Ручки «отключить чеклист» в API нет — есть только подключение
  // снимком. Чистим в базе: стенд локальный, а снимок под чужой спекой
  // молча поменял бы требования к сдаче.
  psql(`
DELETE FROM project_checklist_items WHERE project_id = '${projectId}';
DELETE FROM project_checklist_snapshot WHERE project_id = '${projectId}';
`);
  const admin = await api('admin');
  await admin.delete(`/api/v1/admin/checklist_templates/${templateId}`);
  await admin.dispose();
}

const signInCreator = (context: import('@playwright/test').BrowserContext) =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.creator] as const,
  );

/** Открыть окно сдачи у единственной открытой выкладки. */
async function openSubmit(page: Page, projectId: string): Promise<void> {
  await page.goto(`/me/creator/projects/${projectId}`);
  // Кнопка в строке выкладки называется коротко — «Сдать»; «сдать
  // ролик» осталось заголовком окна, которое она открывает.
  const submit = page.locator('.posts-stack').getByRole('button', { name: 'Сдать', exact: true }).first();
  await expect(submit, 'у открытой выкладки есть чем сдать').toBeVisible({ timeout: 15_000 });
  await submit.click();
  await expect(page.locator('.modal').filter({ hasText: 'сдать ролик' })).toBeVisible();
}

test('подключённый чеклист виден там, где сдают', async ({ context, page }) => {
  const projectId = box.projectId;
  const batchId = await seedOpenPublication(projectId);
  const templateId = await attachChecklist(projectId);
  try {
    await signInCreator(context);
    await openSubmit(page, projectId);

    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    await expect(modal.getByText('Товар в кадре с первой секунды')).toBeVisible();
    await expect(modal.getByText('Ссылка в описании')).toBeVisible();

    // Обязательный пункт помечен: он не совет, а условие приёмки, и
    // именно он гасит кнопку «Сдать».
    const required = modal.locator('.ck').filter({ hasText: 'Товар в кадре' });
    await expect(required).toContainText('обязательно');

    // И его можно отметить. Раньше пункты не рисовались вовсе, а кнопку
    // гасили — человек читал «не отмечено обязательных пунктов: 1» и не
    // мог сделать ничего.
    await required.click();
    await expect(required).toHaveClass(/on/);
  } finally {
    await detachChecklist(projectId, templateId);
    dropBatch(batchId);
  }
});

test('без подключённого шаблона креатору сказано, что чеклиста нет', async ({ context, page }) => {
  const projectId = box.projectId;
  const batchId = await seedOpenPublication(projectId);
  try {
    await signInCreator(context);
    await openSubmit(page, projectId);

    const modal = page.locator('.modal').filter({ hasText: 'сдать ролик' });
    // Пустое место под полями ссылок читается как «требований нет». Это
    // разные вещи: «чеклист не подключён» значит, что требования могут
    // прийти словами от менеджера, а не что их не будет.
    await expect(
      modal.getByText(/[Чч]еклист.*не задан/),
      'окно обязано сказать, что чеклиста у проекта нет',
    ).toBeVisible();

    // Пустого списка при этом нет: галочки, которых не существует, —
    // это и есть то самое молчание, только с рамками.
    await expect(modal.locator('.ck')).toHaveCount(0);
  } finally {
    dropBatch(batchId);
  }
});
