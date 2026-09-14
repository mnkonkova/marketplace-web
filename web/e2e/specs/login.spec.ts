import { test, expect } from '@playwright/test';

/**
 * Вход через настоящую форму.
 *
 * Остальные специи кладут сессию в браузер напрямую — так быстрее и
 * устойчивее. Но тогда сам вход не проверяет никто, а это первое, что
 * ломается: форма, которая не отправляет запрос, выглядит рабочей.
 */
test('вход по паролю доводит до кабинета', async ({ page }) => {
  // Главная в режиме разработки собирается лениво и по первому заходу
  // может думать дольше минуты. Ждём готовности разметки, а не полной
  // загрузки всех ресурсов: кнопка входа к этому моменту уже на месте.
  test.setTimeout(120_000);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });

  await page.getByRole('button', { name: 'Войти' }).first().click();

  await page.getByPlaceholder('Email').fill('e2e-client@example.com');
  await page.getByPlaceholder('Пароль').fill('E2ePassw0rd!');
  await page
    .getByRole('button', { name: /Войти|Войти в аккаунт/ })
    .last()
    .click();

  // Признак входа — исчезнувшая кнопка «Войти» в шапке: разметку кабинета
  // проверяют другие специи, здесь важен сам факт установленной сессии.
  await expect(page.getByRole('button', { name: 'Войти' })).toHaveCount(0, { timeout: 15_000 });

  const stored = await page.evaluate(() => localStorage.getItem('marketpclce.auth.v1'));
  expect(stored, 'после входа сессия должна лежать в localStorage').toBeTruthy();
  expect(JSON.parse(stored!).access_token).toBeTruthy();
});
