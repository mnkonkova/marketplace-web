import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Навигация персонала: у каждого своя оболочка, и проект открывается
 * внутри неё.
 *
 * Всё, что здесь проверяется, ломается молча. Новая вкладка выглядит как
 * «открылось» — пока не понадобится вернуться к списку. Чужая оболочка
 * вокруг карточки проекта подменяет админу разделы на менеджерские:
 * страница при этом рисуется правильно. А витринная шапка поверх админки
 * не ломает ничего вовсе — она просто съедает первый экран и приносит
 * второй «Выйти», про который нельзя сказать, выход это из аккаунта или
 * из админки.
 *
 * Поэтому проверяем не разметку оболочки, а её обещания: админ остаётся в
 * своих разделах, выход один, дорога назад — крошками, и в карточке
 * проекта ему не показывают чужой рабочий день.
 */
const signIn = (context: import('@playwright/test').BrowserContext, role: 'admin' | 'manager') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

/** Всё, что человек может прочитать как «выйти», сколько бы их ни было. */
const logouts = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Выйти/ });

test('у менеджера свои разделы, админских среди них нет', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto('/manager');

  const tabs = page.locator('nav.nav .tab');
  await expect(tabs.filter({ hasText: 'Заявки' })).toBeVisible({ timeout: 15_000 });
  // «Прайс» — админский раздел; у менеджера его быть не должно ни в каком виде.
  await expect(page.getByRole('link', { name: 'Прайс' })).toHaveCount(0);
  await expect(page.locator('.admin-nav')).toHaveCount(0);

  await tabs.filter({ hasText: 'Канбан' }).click();
  await expect(page).toHaveURL(/\/manager\/board$/);
});

test('админка — своя оболочка: сайдбар с группами, без витринной шапки и с одним выходом', async ({
  context,
  page,
}) => {
  await signIn(context, 'admin');
  await page.goto('/admin/tariff');

  const nav = page.locator('.admin-nav');
  await expect(nav.getByRole('link', { name: 'Прайс' })).toBeVisible({ timeout: 15_000 });

  // Витринная навигация покупателя внутри админки не нужна и уносит
  // первый экран: до первой строки содержимого уходила треть высоты.
  await expect(page.locator('app-header')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Все специалисты' })).toHaveCount(0);

  // Разделы разложены по смыслу, а не в один ряд из восьми штук.
  for (const group of ['Работа', 'Справочники', 'Люди']) {
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  }

  // Два «выхода» на экране — иконка в шапке и красная кнопка в полосе —
  // не давали понять, что из них выход из аккаунта, а что из админки.
  await expect(logouts(page)).toHaveCount(1);
  // Уход на витрину — это переход, а не выход, и выглядеть он должен иначе.
  await expect(nav.getByRole('link', { name: '← На сайт' })).toBeVisible();

  await nav.getByRole('link', { name: 'Воронки' }).click();
  await expect(page).toHaveURL(/\/admin\/pipelines$/);
});

test('админ открывает проект в той же вкладке и остаётся в админской оболочке', async ({
  context,
  page,
}) => {
  await signIn(context, 'admin');
  await page.goto('/admin/projects');

  const before = context.pages().length;
  await page.getByText('PetFlat · UGC (e2e)').first().click();

  await expect(page).toHaveURL(/\/manager\/projects\//, { timeout: 15_000 });
  expect(context.pages().length, 'новой вкладки быть не должно').toBe(before);

  // Разделы остались админскими: «Прайс» есть только у админа.
  await expect(page.locator('.admin-nav').getByRole('link', { name: 'Прайс' })).toBeVisible();
  // Менеджерских разделов при этом не появилось.
  await expect(page.locator('nav.nav .tab')).toHaveCount(0);
  // И выход по-прежнему один — витринная шапка не вернулась вместе с карточкой.
  await expect(logouts(page)).toHaveCount(1);

  // Страница менеджерская, действия на ней запишутся на админа — и об
  // этом сказано на месте, а не выясняется по логу.
  await expect(page.getByText(/Вы смотрите как\s+администратор/)).toBeVisible();
});

test('в карточке проекта у админа крошки вместо пилюли и никакой чужой боковой колонки', async ({
  context,
  page,
}) => {
  await signIn(context, 'admin');
  await page.goto(`/manager/projects/${world().projectId}`);

  // Дорогу назад держат крошки в полосе сверху: «Ко всем проектам»
  // занимала отдельную строку, чтобы сказать то же самое.
  const crumbs = page.locator('.crumbs');
  await expect(crumbs.getByRole('link', { name: 'Проекты' })).toBeVisible({ timeout: 15_000 });
  await expect(crumbs).toContainText('PetFlat · UGC (e2e)');
  await expect(page.locator('.back-link')).toHaveCount(0);

  // Менеджерская колонка в чужом проекте говорила неправду: «Других
  // проектов на вас нет» — потому что проект не ваш, — и считала чей-то
  // чужой день.
  await expect(page.locator('.crm-page .aside')).toBeHidden();
  await expect(page.getByText('Других проектов на вас нет')).toBeHidden();
  // То, что в ней было правдой, админ видит в своём блоке.
  await expect(page.getByText('Ответственный менеджер')).toBeVisible();
  await expect(page.getByText('История изменений')).toBeVisible();

  await crumbs.getByRole('link', { name: 'Проекты' }).click();
  await expect(page).toHaveURL(/\/admin\/projects$/);
});

test('вкладки проекта остаются на виду при прокрутке', async ({ context, page }) => {
  await signIn(context, 'admin');
  // Низкое окно намеренно: у посеянного проекта содержимого на пол-экрана,
  // и на обычном окне страница просто не прокручивается настолько, чтобы
  // вкладки успели уехать, — тест был бы зелёным и без липкости.
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(`/manager/projects/${world().projectId}`);

  const tabs = page.locator('.content .crm-page .tabs').first();
  await expect(tabs).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);

  const box = await tabs.boundingBox();
  expect(box, 'вкладки должны остаться в разметке').not.toBeNull();
  // Прижаты под полосой крошек (52px), а не уехали за верх экрана: без
  // липкости они оказались бы на отрицательном y.
  expect(box!.y, `вкладки уехали на y=${box?.y}`).toBeGreaterThanOrEqual(40);
  expect(box!.y, `вкладки уехали на y=${box?.y}`).toBeLessThan(120);
});

test('удаление проекта спрятано в меню и требует ввести название', async ({ context, page }) => {
  await signIn(context, 'admin');
  await page.goto(`/manager/projects/${world().projectId}`);
  await expect(page.locator('.crumbs')).toBeVisible({ timeout: 15_000 });

  // Кнопки удаления вплотную к «Применить» на экране больше нет.
  await expect(page.getByRole('button', { name: /Удалить проект/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Действия с проектом' }).click();
  await page.getByRole('menuitem', { name: 'Удалить проект' }).click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'Удалить проект' });
  await expect(dialog).toBeVisible();

  // Пустое подтверждение не удаляет: «да/нет» здесь нажимается рефлекторно,
  // а проект уходит из всех списков сразу.
  await dialog.getByRole('button', { name: 'Удалить' }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/manager/projects/${world().projectId}`));

  // Мусора за собой не оставляем: проект нужен остальным специям.
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
});

test('менеджер видит ту же карточку в своём кабинете', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto(`/manager/projects/${world().projectId}`);

  const tabs = page.locator('nav.nav .tab');
  await expect(tabs.filter({ hasText: 'Заявки' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.admin-nav')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Прайс' })).toHaveCount(0);
});
