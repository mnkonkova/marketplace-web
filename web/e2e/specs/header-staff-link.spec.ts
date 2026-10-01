import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Вход в рабочий кабинет — одной ссылкой.
 *
 * В шапке витрины стояли две: «Менеджер» (/manager) и «Админ» (/admin).
 * У того, кто и менеджер и админ, они шли подряд и читались как два
 * разных продукта — хотя за ними один и тот же экран, который сам
 * выбирает, что показать по правам. Кабинет и называется теперь
 * одинаково: «Админка».
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('header');
});

test.afterAll(() => dropSandbox(box));

for (const [role, href] of [
  ['admin', '/admin'],
  ['manager', '/manager'],
] as const) {
  test(`${role}: в шапке один вход — «Админка» на ${href}`, async ({ context, page }) => {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions[role]] as const,
    );
    await page.goto('/');

    const header = page.locator('app-header');
    // Ждём саму шапку: роли приезжают из сессии, и до этого момента
    // рабочих ссылок в ней нет вовсе.
    await expect(header.getByRole('link', { name: 'Кабинет' })).toBeVisible({ timeout: 20_000 });
    const staff = header.getByRole('link', { name: 'Админка' });
    await expect(staff).toHaveCount(1, { timeout: 15_000 });
    await expect(staff).toHaveAttribute('href', href);

    // Прежних подписей не осталось: две ссылки рядом — это и была
    // путаница.
    await expect(header.getByRole('link', { name: 'Менеджер', exact: true })).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Админ', exact: true })).toHaveCount(0);
  });
}
