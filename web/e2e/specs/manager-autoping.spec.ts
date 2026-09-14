import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Автопинг — ровно тот случай, ради которого браузерные тесты и нужны.
 *
 * Тумблер переключается оптимистично: интерфейс меняет вид сразу, а
 * запрос уходит следом. Если запрос не ушёл или ответ потерялся, экран
 * выглядит правильным до перезагрузки — юнит-тест этого не увидит,
 * потому что проверяет функцию, а не то, что кнопка к ней привязана.
 */
test.beforeEach(async ({ context }) => {
  const w = world();
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, w.sessions.manager] as const,
  );
});

const SWITCH = 'Креатору в бот — утром в день выкладки';

/**
 * Тумблер ищем по тексту строки, а не по роли.
 *
 * nz-switch рисует обычную кнопку без role="switch" и без aria-checked, а
 * aria-label вешается на внешний элемент — до самой кнопки он не доходит.
 * Для скринридера это безымянная кнопка без состояния; починка на стороне
 * ng-zorro, и тест на неё не завязываем. Состояние читаем по классу,
 * которым компонент и рисует положение.
 */
const toggleIn = (page: import('@playwright/test').Page) =>
  page.locator('.switchrow', { hasText: SWITCH }).locator('button.ant-switch');

/**
 * У проекта «креаторы под ключ» страница разложена вкладками — автопинг
 * живёт в «Креаторах». Открываем её явно: тумблера на первой вкладке нет,
 * и без этого тест падал бы «элемент не найден», а не «настройка не
 * сохранилась».
 */
const openCrew = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: /^Креаторы/ }).click();
};

const isOn = async (page: import('@playwright/test').Page): Promise<boolean> => {
  const cls = (await toggleIn(page).getAttribute('class')) ?? '';
  return cls.includes('ant-switch-checked');
};

test('выключенный тумблер переживает перезагрузку', async ({ page }) => {
  const w = world();
  await page.goto(`/manager/projects/${w.projectId}`);
  await openCrew(page);

  const toggle = toggleIn(page);
  await expect(toggle, 'проект без настроек пингуется полностью').toBeVisible({ timeout: 15_000 });
  expect(await isOn(page), 'по умолчанию включено').toBe(true);

  // Ждём именно запрос: без него «переключилось» означает только то, что
  // перерисовался компонент.
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/projects/${w.projectId}/autoping`) && r.request().method() === 'PUT',
    ),
    toggle.click(),
  ]);
  expect(response.status(), 'сохранение автопинга').toBe(200);

  await page.reload();
  await openCrew(page);
  await expect(toggleIn(page)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => isOn(page), { timeout: 10_000, message: 'выключенное должно остаться выключенным' })
    .toBe(false);

  // Возвращаем как было: специи идут по одному проекту, и оставленный
  // выключенным тумблер сломал бы следующий прогон этого же теста.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/autoping') && r.request().method() === 'PUT'),
    toggleIn(page).click(),
  ]);
});

test('отказ сервера откатывает тумблер, а не оставляет его переключённым', async ({ page }) => {
  const w = world();
  await page.goto(`/manager/projects/${w.projectId}`);
  await openCrew(page);

  const toggle = toggleIn(page);
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  expect(await isOn(page)).toBe(true);

  // Сервер отвечает ошибкой — интерфейс обязан вернуть тумблер на место.
  // Иначе менеджер уверен, что напоминания выключены, а бот их шлёт.
  await page.route('**/autoping', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, body: '{"error":"internal"}' })
      : route.continue(),
  );

  await toggle.click();
  await expect
    .poll(() => isOn(page), { timeout: 10_000, message: 'после отказа состояние должно вернуться' })
    .toBe(true);
});
