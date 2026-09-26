import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * «Заказать следующий месяц» — от прикидки до плашки у менеджера.
 *
 * Прикидка цены в кабинете заказчика была справочной: посмотрел и
 * закрыл, а дальше человек шёл писать менеджеру словами — и половина не
 * доходила вовсе. Кнопка делает из неё заявку, и ломается эта дорога
 * тихо: кнопка нажимается, сообщение об успехе показывается, а у
 * менеджера ничего не загорается — узнают об этом от заказчика, который
 * ждал неделю.
 *
 * Поэтому специя проходит путь целиком: заказчик нажал — менеджер увидел
 * плашку с теми же числами — отметил разобранной — плашка погасла.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('monthask', { ownClient: true });
});

test.afterAll(() => dropSandbox(box));

async function signIn(
  context: import('@playwright/test').BrowserContext,
  role: 'manager' | 'client',
): Promise<void> {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );
}

test('заказчик просит месяц — у менеджера загорается плашка с теми же числами', async ({
  browser,
}) => {
  const clientCtx = await browser.newContext();
  await signIn(clientCtx, 'client');
  const client = await clientCtx.newPage();

  await client.goto(`/me/projects/${box.projectId}`);
  await client.locator('button[data-tab="money"]').click();

  const panel = client
    .locator('.panel')
    .filter({ hasText: 'Сколько будет стоить следующий месяц' });
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Число на экране и число в заявке — одно и то же: разговор пойдёт о
  // той сумме, которую человеку показали.
  const ceiling = (await panel.locator('.ceil .num').innerText()).trim();
  expect(ceiling, 'потолок посчитан').not.toBe('');

  const [sent] = await Promise.all([
    client.waitForResponse(
      (r) => r.url().includes('/month-request') && r.request().method() === 'POST',
    ),
    panel.getByRole('button', { name: /Заказать этот месяц/ }).click(),
  ]);
  expect(sent.status(), await sent.text()).toBe(201);
  const asked = (await sent.json()).request;

  // Кнопка сменилась состоянием: иначе человек жмёт второй раз, не
  // понимая, ушло ли первое.
  await expect(panel.locator('.asked')).toContainText('Заявка у менеджера');
  await expect(panel.getByRole('button', { name: /Заказать этот месяц/ })).toHaveCount(0);

  // Менеджер видит ту же просьбу плашкой в «Где сейчас горит».
  const managerCtx = await browser.newContext();
  await signIn(managerCtx, 'manager');
  const manager = await managerCtx.newPage();
  await manager.goto(`/manager/projects/${box.projectId}`);

  const alert = manager.locator('.alert').filter({ hasText: 'Заказчик просит следующий месяц' });
  await expect(alert, 'плашка о просьбе').toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText(String(asked.videos));
  await expect(alert).toContainText(String(asked.creators));

  // Разобрал — плашка гаснет. Незатухающая плашка хуже отсутствующей:
  // через неделю на неё перестают смотреть вовсе.
  await Promise.all([
    manager.waitForResponse(
      (r) => r.url().includes('/month-request/handled') && r.request().method() === 'POST',
    ),
    alert.getByRole('button', { name: /Связались, разобрал/ }).click(),
  ]);
  await expect(alert).toHaveCount(0);

  await clientCtx.close();
  await managerCtx.close();
});
