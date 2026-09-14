import { test, expect, request, APIRequestContext } from '@playwright/test';
import { AUTH_KEY, psql, world } from '../fixtures/world';

/**
 * Список проектов в админке.
 *
 * До правки это была плоская таблица: без поиска, фильтров, сортировки и
 * страниц, и половину её занимали проекты, заведённые при проверке
 * стенда. Ответить по ней на вопрос «что не двигалось неделю и кто за
 * это отвечает» было нельзя — не было ни колонки менеджера, ни даты.
 *
 * Специя заводит два своих проекта (обычный и помеченный тестовым) и
 * сносит их в finally: мир переиспользуется между прогонами, и оставленный
 * проект менял бы ожидания соседних специй.
 */

const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

// Метка уникальна на прогон: на стенде живут настоящие проекты, и поиск
// по «тест» нашёл бы их заодно.
const mark = `e2e${Date.now().toString(36)}`;
const realTitle = `Список ${mark} обычный`;
const testTitle = `Список ${mark} тестовый`;

let api: APIRequestContext;
let created: string[] = [];

test.beforeAll(async () => {
  const w = world();
  api = await request.newContext({ baseURL: API });
  const auth = { Authorization: `Bearer ${w.sessions.admin.access_token}` };
  const me = await api.get('/api/v1/me', {
    headers: { Authorization: `Bearer ${w.sessions.client.access_token}` },
  });
  const clientId = (await me.json()).user_id as string;

  for (const [title, isTest] of [
    [realTitle, false],
    [testTitle, true],
  ] as const) {
    const res = await api.post('/api/v1/admin/projects', {
      headers: auth,
      // Креаторы под ключ: их можно завести одним запросом. Общему проекту
      // база требует исполнителя и срок, продакшну — воронку.
      data: { kind: 'creators_turnkey', title, client_user_id: clientId, is_test: isTest },
    });
    if (res.status() !== 201) {
      throw new Error(`создать проект «${title}»: ${res.status()} ${await res.text()}`);
    }
    created.push((await res.json()).id as string);
  }
});

test.afterAll(async () => {
  try {
    for (const id of created) {
      psql(`DELETE FROM outbox WHERE aggregate = 'project' AND aggregate_id = '${id}';
            DELETE FROM projects WHERE id = '${id}';`);
    }
  } finally {
    created = [];
    await api.dispose();
  }
});

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.admin] as const,
  );
  await page.goto('/admin/projects');
  await expect(page.locator('[data-test="projects-search"]')).toBeVisible({ timeout: 15_000 });
});

test('поиск сужает список запросом к серверу, а не в браузере', async ({ page }) => {
  const search = page.locator('[data-test="projects-search"]');

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/admin/projects?') && r.url().includes('q='), {
      timeout: 15_000,
    }),
    search.fill(mark),
  ]);
  // Фильтрация на сервере: параметр уехал в запрос, и страница пришла
  // уже суженной. Пока список фильтровался в браузере, запрос был один и
  // без параметров.
  expect(new URL(response.url()).searchParams.get('q')).toBe(mark);

  const rows = page.locator('[data-test="project-row"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(realTitle);
  // Тестовый проект с тем же маркером в выдачу не попал.
  await expect(page.locator('[data-test="project-row"]', { hasText: testTitle })).toHaveCount(0);
});

test('тестовые проекты показываются только по просьбе', async ({ page }) => {
  await page.locator('[data-test="projects-search"]').fill(mark);
  await expect(page.locator('[data-test="project-row"]')).toHaveCount(1);

  await page.locator('[data-test="projects-include-test"]').click();

  const rows = page.locator('[data-test="project-row"]');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-test="project-row"]', { hasText: testTitle })).toHaveCount(1);
  await expect(page.locator('[data-test="projects-total"]')).toHaveText('2');
});

test('строка отвечает на «что не двигалось и кто отвечает»', async ({ page }) => {
  await page.locator('[data-test="projects-search"]').fill(mark);
  const row = page.locator('[data-test="project-row"]').first();
  await expect(row).toContainText(realTitle);

  // Менеджер: проект заведён админом без ответственного — и это должно
  // быть сказано словами, а не прочерком.
  await expect(row.locator('td[data-label="Менеджер"]')).toHaveText(/Не назначен/);

  // Обновлён: по-человечески в ячейке, точная дата — в title.
  const updated = row.locator('td[data-label="Обновлён"]');
  await expect(updated).toHaveText(/назад|только что/);
  await expect(updated).toHaveAttribute('title', /\d{2}\.\d{2}\.\d{4}/);

  // Прогресс: число рядом с полоской и подпись, чем он меряется. У
  // креаторов это выкладки, у продакшна — шаги воронки; без подписи два
  // числа в соседних строках выглядели бы сравнимыми, не будучи такими.
  const progress = row.locator('td[data-label="Прогресс"]');
  await expect(progress).toHaveText(/0%/);
  await expect(progress).toHaveText(/по выкладкам/);

  // Стадий у этого вида не бывает — так и написано. Прочерк читался как
  // потерянные данные.
  await expect(row.locator('td[data-label="Стадия"]')).toHaveText(/Без стадий — план выкладок/);
});

test('сортировка по умолчанию — самые давно не двигавшиеся сверху', async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/admin/projects?'), { timeout: 15_000 }),
    page.reload(),
  ]);
  expect(new URL(response.url()).searchParams.get('sort')).toBe('updated_asc');
});

test('название короче трёх символов не создаётся', async ({ page }) => {
  await page.getByRole('button', { name: '+ Создать проект' }).click();
  // Имя окна берём текстом, а не через aria-label: nz-modal рисует
  // заголовок сам, и доступного имени у диалога нет.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Создать проект' });
  await expect(dialog).toBeVisible();

  await dialog.locator('input[name="cn"]').fill('Кто-то');
  await dialog.locator('input[name="cc"]').fill('+79990000000');
  await dialog.locator('[data-test="create-project-title"]').fill('  ы  ');
  await dialog.getByRole('button', { name: 'Создать' }).click();

  // Окно остаётся открытым: иначе правку негде было бы поправить, а
  // проект «ы» уже уехал бы в список.
  await expect(dialog).toBeVisible();
  await expect(page.locator('.ant-message')).toContainText('минимум 3 символа');
});
