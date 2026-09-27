import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Навигация персонала: одна оболочка на две роли, и проект открывается
 * внутри неё.
 *
 * Всё, что здесь проверяется, ломается молча. Новая вкладка выглядит как
 * «открылось» — пока не понадобится вернуться к списку. Чужие разделы
 * вокруг карточки проекта подменяют админу его собственные: страница при
 * этом рисуется правильно. А витринная шапка поверх CRM не ломает ничего
 * вовсе — она просто съедает первый экран и приносит второй «Выйти», про
 * который нельзя сказать, выход это из аккаунта или из кабинета.
 *
 * Поэтому проверяем не разметку оболочки, а её обещания: у каждой роли
 * свои разделы, выход один, дорога назад — крошками, и в карточке проекта
 * админу не показывают чужой рабочий день.
 */
const signIn = (context: import('@playwright/test').BrowserContext, role: 'admin' | 'manager') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );

/** Всё, что человек может прочитать как «выйти», сколько бы их ни было. */
const logouts = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Выйти/ });

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
  box = await createSandbox('staffnav', { isTest: false });
});

test.afterAll(() => dropSandbox(box));

test('у менеджера свои разделы, админских среди них нет', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto('/manager');

  const nav = page.locator('.crm-shell .side');
  await expect(nav.getByRole('link', { name: 'Входящие' })).toBeVisible({ timeout: 15_000 });
  await expect(nav.getByRole('link', { name: 'Мои проекты' })).toBeVisible();
  // «Прайс» — админский раздел; у менеджера его быть не должно ни в каком виде.
  await expect(page.getByRole('link', { name: 'Прайс' })).toHaveCount(0);
  await expect(nav.getByText('Креаторы', { exact: true })).toHaveCount(0);

  await nav.getByRole('link', { name: 'Мои проекты' }).click();
  await expect(page).toHaveURL(/\/manager\/projects$/);
});

test('админка — своя оболочка: сайдбар с группами, без витринной шапки и с одним выходом', async ({
  context,
  page,
}) => {
  await signIn(context, 'admin');
  await page.goto('/admin/tariff');

  const nav = page.locator('.crm-shell .side');
  await expect(nav.getByRole('link', { name: 'Прайс' })).toBeVisible({ timeout: 15_000 });

  // Витринная навигация покупателя внутри CRM не нужна и уносит первый
  // экран: до первой строки содержимого уходила треть высоты.
  await expect(page.locator('app-header')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Все специалисты' })).toHaveCount(0);

  // Разделы разложены по поводам зайти, а не в один ряд из восьми штук.
  for (const group of ['Работа', 'Люди', 'Креаторы', 'Продакшн']) {
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  }

  // Два «выхода» на экране — иконка в шапке и красная кнопка в полосе —
  // не давали понять, что из них выход из аккаунта, а что из админки.
  await expect(logouts(page)).toHaveCount(1);
  // Уход на витрину — это переход, а не выход, и стоит он пунктом меню.
  await expect(nav.getByRole('link', { name: 'На сайт' })).toBeVisible();

  await nav.getByRole('link', { name: 'Воронки' }).click();
  await expect(page).toHaveURL(/\/admin\/pipelines$/);
});

/**
 * Канбан перестал быть отдельным разделом, но его адреса уже разошлись по
 * закладкам и переписке. Старая спека кликала вкладку «Канбан» в
 * менеджерском кабинете; проверяем то же обещание — «канбан открывается»,
 * — но по обоим путям: прямой ссылкой и переключателем в шапке раздела.
 */
test('старые адреса канбана открывают раздел проектов нужным видом', async ({ context, page }) => {
  await signIn(context, 'admin');

  await page.goto('/admin/board');
  await expect(page).toHaveURL(/\/admin\/projects\?view=board$/, { timeout: 15_000 });

  await page.goto('/manager/board');
  await expect(page).toHaveURL(/\/manager\/projects\?view=board$/);

  // И обратно — тем же переключателем, что показан в шапке раздела.
  await page.getByRole('button', { name: 'Список' }).click();
  await expect(page).toHaveURL(/\/manager\/projects$/);
});

test('прежние адреса разделов админки никуда не делись', async ({ context, page }) => {
  await signIn(context, 'admin');

  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });

  await page.goto('/admin/managers');
  await expect(page).toHaveURL(/\/admin\/team$/);
});

test('админ открывает проект в той же вкладке и остаётся в своих разделах', async ({
  context,
  page,
}) => {
  await signIn(context, 'admin');
  await page.goto('/admin/projects');

  const before = context.pages().length;
  await page.getByText(box.title).first().click();

  await expect(page).toHaveURL(/\/manager\/projects\//, { timeout: 15_000 });
  expect(context.pages().length, 'новой вкладки быть не должно').toBe(before);

  // Разделы остались админскими: «Прайс» есть только у админа.
  await expect(page.locator('.crm-shell .side').getByRole('link', { name: 'Прайс' })).toBeVisible();
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
  await page.goto(`/manager/projects/${box.projectId}`);

  // Дорогу назад держат крошки в полосе сверху: «Ко всем проектам»
  // занимала отдельную строку, чтобы сказать то же самое.
  const crumbs = page.locator('.crumbs');
  await expect(crumbs.getByRole('link', { name: 'Проекты' })).toBeVisible({ timeout: 15_000 });
  await expect(crumbs).toContainText(box.title);
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

test('полоса пути остаётся на виду при прокрутке', async ({ context, page }) => {
  await signIn(context, 'admin');
  // Низкое окно намеренно: у посеянного проекта содержимого на пол-экрана,
  // и на обычном окне страница просто не прокручивается настолько, чтобы
  // шапка успела уехать, — тест был бы зелёным и без липкости.
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(`/manager/projects/${box.projectId}`);

  // Дорога назад, а не вкладки: карточка проекта на десктопе — одна
  // длинная страница, вкладки остались только на телефоне
  // (app-prmarket-tabbar). Уехавшая наверх полоса пути на такой странице
  // означает, что из проекта некуда выйти, не промотав его целиком.
  const bar = page.locator('.crm-shell .topbar').first();
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await expect(bar.getByRole('link', { name: 'Проекты' })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);

  const rect = await bar.boundingBox();
  expect(rect, 'полоса пути должна остаться в разметке').not.toBeNull();
  // Прижата к верху окна (top: 0), а не уехала за него: без липкости она
  // оказалась бы на отрицательном y.
  expect(rect!.y, `полоса пути уехала на y=${rect?.y}`).toBeGreaterThanOrEqual(0);
  expect(rect!.y, `полоса пути уехала на y=${rect?.y}`).toBeLessThan(40);
  await expect(bar.getByRole('link', { name: 'Проекты' })).toBeInViewport();
});

test('удаление проекта спрятано в меню и требует ввести название', async ({ context, page }) => {
  await signIn(context, 'admin');
  await page.goto(`/manager/projects/${box.projectId}`);
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
  await expect(page).toHaveURL(new RegExp(`/manager/projects/${box.projectId}`));

  // Мусора за собой не оставляем: проект нужен остальным специям.
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
});

test('менеджер видит ту же карточку в своих разделах', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto(`/manager/projects/${box.projectId}`);

  const nav = page.locator('.crm-shell .side');
  await expect(nav.getByRole('link', { name: 'Входящие' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Прайс' })).toHaveCount(0);
  // Пометки «вы смотрите как администратор» у менеджера быть не должно:
  // это его собственный проект, и действия запишутся на него.
  await expect(page.getByText(/Вы смотрите как/)).toHaveCount(0);
});
