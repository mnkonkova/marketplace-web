import { test, expect, type Page, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, lockFirstPeriod, world } from '../fixtures/world';

/**
 * Переоткрытие подытоженного периода.
 *
 * Это правка уже выставленного счёта: срез снимается заново, суммы
 * пересчитываются по сегодняшним цифрам, и заказчик увидит не то число,
 * которое видел вчера. Поэтому действие оставлено одному админу и
 * обязано попадать в журнал — по записи в нём потом и объясняют, почему
 * счёт изменился.
 *
 * Ловушка, из-за которой такая специя легко зеленеет впустую:
 * переоткрыть УЖЕ открытый период сервер разрешает и отвечает успехом,
 * но в журнал при этом не пишет ничего. Тест, который жмёт кнопку на
 * идущем периоде, увидит «Период переоткрыт» и останется зелёным
 * навсегда — в том числе когда запись в журнал перестанут делать вовсе.
 * Поэтому: сначала убеждаемся, что период действительно подытожен, потом
 * жмём ровно один раз, потом ищем в журнале запись, которой до этого не
 * было.
 *
 * Подытог возвращаем на место: он приготовлен данными для соседних
 * специй, и оставить период открытым значит сломать их через раз.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

const signIn = (context: import('@playwright/test').BrowserContext, role: 'manager' | 'admin') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

interface AuditEntry {
  id: number;
  action: string;
  object_id: string;
}

/** Записи журнала про переоткрытие периодов этого проекта. */
async function unlockEntries(projectId: string): Promise<AuditEntry[]> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.admin.access_token}` },
  });
  const res = await api.get(
    `/api/v1/admin/audit?action=project.period_unlock&object_id=${projectId}&limit=100`,
  );
  const items = ((await res.json()).items ?? []) as AuditEntry[];
  await api.dispose();
  return items;
}

/** Состояние первого периода проекта прямо сейчас. */
async function firstPeriodStatus(projectId: string): Promise<string> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.manager.access_token}` },
  });
  const res = await api.get(`/api/v1/manager/projects/${projectId}/billing/periods`);
  const items = ((await res.json()).items ?? []) as { seq: number; status: string }[];
  await api.dispose();
  return items.find((p) => p.seq === 1)?.status ?? '';
}

/** Открыть вкладку «Начисления» на подытоженном периоде. */
async function openLockedPeriod(page: Page, projectId: string): Promise<void> {
  await page.goto(`/manager/projects/${projectId}?period=1`);
  await page.getByRole('button', { name: 'Начисления' }).click();
  await expect(page.locator('.period-line')).toContainText('Период 1', { timeout: 15_000 });
}

test('переоткрыть подытоженный период может только админ, и это попадает в журнал', async ({
  context,
  page,
}) => {
  const projectId = world().historyProjectId;
  expect(
    await firstPeriodStatus(projectId),
    'период обязан быть подытожен до нажатия: на открытом кнопка ничего не меняет и в журнал не пишет',
  ).toBe('locked');

  const before = await unlockEntries(projectId);

  await signIn(context, 'admin');
  await openLockedPeriod(page, projectId);

  const button = page.getByRole('button', { name: 'Переоткрыть период' });
  await expect(button, 'подытоженный период админ может переоткрыть').toBeVisible();
  await button.click();

  // Предупреждение до нажатия, а не после: заказчик уже видел этот счёт.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Переоткрыть период 1' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Счёт, который заказчик уже видел, изменится/);
  await dialog.getByRole('button', { name: 'OK' }).click();

  try {
    await expect(page.getByText('Период переоткрыт')).toBeVisible({ timeout: 15_000 });
    expect(await firstPeriodStatus(projectId), 'период должен стать открытым').toBe('open');

    // Ровно одна новая запись, и раньше её не было: сравниваем по
    // идентификаторам, а не по количеству — стенд общий, и соседняя
    // специя могла добавить своих.
    const after = await unlockEntries(projectId);
    const fresh = after.filter((e) => !before.some((b) => b.id === e.id));
    expect(fresh, 'переоткрытие обязано оставить след в журнале').toHaveLength(1);

    // И запись читается по-русски: кодом действия она выглядит как
    // техническая строка, то есть как «не про деньги».
    await page.goto(`/admin/audit?object_type=project&object_id=${projectId}`);
    const row = page.locator('[data-test="audit-row"]').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('переоткрыл период');
    await expect(row).toContainText('Админ Тестовый');
  } finally {
    // Возвращаем подытог: он нужен соседним специям, и восстановить его
    // нажатием кнопки нельзя — руками период больше не закрывают.
    lockFirstPeriod(projectId);
  }
});

test('менеджеру переоткрытие не предлагают', async ({ context, page }) => {
  // Действие менеджерское по месту, но не по праву: счёт уже выставлен,
  // и отменять решение автоматики походя нельзя. Кнопка, которая ответит
  // отказом, хуже отсутствующей.
  expect(await firstPeriodStatus(world().historyProjectId)).toBe('locked');

  await signIn(context, 'manager');
  await openLockedPeriod(page, world().historyProjectId);

  await expect(page.locator('.period-line')).toContainText('Данные приблизительные');
  await expect(page.getByRole('button', { name: 'Переоткрыть период' })).toHaveCount(0);
});
