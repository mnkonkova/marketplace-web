import { test, expect, devices, type Browser, type Page } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { callAs, createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab } from '../fixtures/ui';

/**
 * Документы: путь от шаблона в админке до «открыт» у менеджера.
 *
 * Админ заводит шаблон в разделе «Документы» под прайсом, менеджер выдаёт его креатору,
 * креатор находит документ в «Моих документах» и открывает — и менеджер
 * видит, что документ дошёл. Плюс телефон: форма выдачи в шторке, а
 * шаблоны в админке не уводят страницу вбок.
 */
let box: Sandbox;
let title: string;
const templateIds: string[] = [];

test.beforeAll(async () => {
  box = await createSandbox('docs');
  title = `Договор e2e ${box.tag}`;
});

test.afterAll(async () => {
  // Шаблоны живут вне проекта — в архив, чтобы не копились в выборе.
  for (const id of templateIds) {
    await callAs(box.admin, 'post', `/api/v1/admin/document_templates/${id}/archive`, {}).catch(
      () => undefined,
    );
  }
  dropSandbox(box);
});

async function signIn(page: Page, role: 'admin' | 'manager' | 'creator' | 'client'): Promise<void> {
  await page
    .context()
    .addInitScript(([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)), [
      AUTH_KEY,
      box.sessions[role],
    ] as const);
}

/**
 * Телефон с касаниями, а не просто узкое окно: шторку виджеты выбирают
 * по поддержке касаний (isTouchDevice), как настоящий телефон.
 */
async function phone(browser: Browser, role: 'admin' | 'manager'): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(
    ([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)),
    [AUTH_KEY, box.sessions[role]] as const,
  );
  return ctx.newPage();
}

async function noSideScroll(page: Page, what: string): Promise<void> {
  const de = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(de.scroll, `${what}: страница не прокручивается вбок`).toBeLessThanOrEqual(de.client);
}

test.describe.serial('путь документа', () => {
  test('админ заводит шаблон рядом с прайсом', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/documents');

    const dt = page.locator('app-document-templates');
    await dt.getByRole('button', { name: 'Новый шаблон' }).click();
    await dt.getByLabel('Название').fill(title);
    await dt.getByLabel('Ссылка на документ').fill('https://docs.example.com/e2e-contract');
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/admin/document_templates') && r.request().method() === 'POST',
      ),
      dt.getByRole('button', { name: 'Завести шаблон' }).click(),
    ]);
    expect(res.status()).toBe(201);
    templateIds.push((await res.json()).id as string);
    await expect(dt.locator('.dt-card', { hasText: title })).toContainText('v1');
  });

  test('менеджер выдаёт шаблон креатору', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto(`/manager/projects/${box.projectId}`);
    await expect(page.locator('.secnav')).toBeVisible({ timeout: 20_000 });
    await page.locator('.secnav button', { hasText: 'Документы' }).click();

    const docs = page.locator('app-project-documents');
    await docs.getByRole('button', { name: 'Выдать документ' }).click();
    await docs.locator('.tpl', { hasText: title }).click();
    await docs.getByLabel('Пояснение').fill('подпишите и пришлите в комментарии');
    await docs.getByRole('button', { name: 'Выдать', exact: true }).click();

    const row = docs.locator('table.pd tbody tr', { hasText: title });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('по шаблону v1');
    await expect(row).toContainText('не открыт');
  });

  test('креатор видит документ и открывает — менеджер видит «открыт»', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'creator');
    await page.goto('/me/creator/projects');
    const mine = page.locator('app-my-documents');
    const link = mine.getByRole('link', { name: title });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(mine.locator('.doc', { hasText: title })).toContainText('новый');

    const [opened] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/me/documents/') && r.url().endsWith('/open')),
      link.click({ modifiers: ['Control'] }),
    ]);
    expect(opened.status()).toBe(200);

    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)),
      [AUTH_KEY, box.sessions.manager] as const,
    );
    const mgr = await ctx.newPage();
    await mgr.goto(`/manager/projects/${box.projectId}?sec=docs`);
    await expect(
      mgr.locator('app-project-documents table.pd tbody tr', { hasText: title }),
    ).toContainText('открыт', { timeout: 15_000 });
    await ctx.close();
  });

  /**
   * Заказчик проекта «под ключ» — у него своя карточка с вкладками, и
   * документ обязан быть в ней: выданный и недостижимый документ навсегда
   * остался бы у менеджера «не открыт».
   */
  test('заказчик проекта «под ключ» видит свой документ', async ({ page }) => {
    const clientTitle = `Акт сверки e2e ${box.tag}`;
    await callAs(box.manager, 'post', `/api/v1/manager/projects/${box.projectId}/documents`, {
      audience: 'client',
      kind: 'act',
      title: clientTitle,
      url: 'https://docs.example.com/e2e-client-act',
    });

    await signIn(page, 'client');
    await page.goto(`/me/projects/${box.projectId}`);
    await openClientTab(page, 'Документы');
    const mine = page.locator('app-my-documents');
    const link = mine.getByRole('link', { name: clientTitle });
    await expect(link).toBeVisible({ timeout: 15_000 });
    const [opened] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/me/documents/') && r.url().endsWith('/open')),
      link.click({ modifiers: ['Control'] }),
    ]);
    expect(opened.status()).toBe(200);
  });

  test('на телефоне выдача — в шторке, документы во вкладке «Команда»', async ({ browser }) => {
    const page = await phone(browser, 'manager');
    await page.goto(`/manager/projects/${box.projectId}`);
    const tab = page.locator('app-prmarket-tabbar button', { hasText: 'Команда' }).first();
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await tab.click();

    const docs = page.locator('app-project-documents');
    await expect(docs.locator('.pd-card', { hasText: title })).toBeVisible();
    await noSideScroll(page, 'команда с документами');

    await docs.getByRole('button', { name: 'Выдать документ' }).click();
    const sheet = page.locator('.ant-drawer').filter({ hasText: 'Выдать документ' });
    await expect(sheet, 'форма открылась шторкой из библиотеки').toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Выдать', exact: true })).toBeVisible();
  });

  test('шаблоны в админке на телефоне — карточками, без прокрутки вбок', async ({ browser }) => {
    const page = await phone(browser, 'admin');
    await page.goto('/admin/documents');
    await expect(page.locator('app-document-templates .dt-card', { hasText: title })).toBeVisible({
      timeout: 15_000,
    });
    await noSideScroll(page, 'шаблоны документов');

    await page
      .locator('app-document-templates')
      .getByRole('button', { name: 'Новый шаблон' })
      .click();
    const sheet = page.locator('.ant-drawer').filter({ hasText: 'Новый шаблон' });
    await expect(sheet, 'форма шаблона на телефоне — шторкой').toBeVisible();
  });
});
