import {
  test,
  expect,
  type Locator,
  type Page,
  request as pwRequest,
  type APIRequestContext,
} from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab, openManagerTab } from '../fixtures/ui';

/**
 * Глубина графика переключается там, где стоит график.
 *
 * У виджета был вход «7 или 30 дней», и менять его было нечем нигде,
 * кроме одного экрана менеджера: на остальных график всегда рисовал
 * тридцать дней, а параметр стоял в коде и выглядел настройкой, до
 * которой просто не добрались. Поломка тихая вдвойне — рисуется
 * правильный график, просто не тот, который человек хотел бы увидеть, и
 * попросить другой ему нечем.
 *
 * Поэтому проверяем не наличие двух кнопок, а то, что они меняют: число
 * точек в ряду. Кнопка, которая подсвечивается и не меняет картинку, —
 * ровно та поломка, из-за которой эта специя и написана.
 *
 * Все три экрана, где виджет живёт, проверяются одним и тем же телом:
 * обещание у них общее, и разойтись они могут только тем, что на одном
 * кнопки забыли.
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
  box = await createSandbox('chart', { shape: 'history' });
});

test.afterAll(() => dropSandbox(box));

const signIn = (
  context: import('@playwright/test').BrowserContext,
  role: 'manager' | 'client' | 'admin',
) =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );

async function clientApi(): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.client.access_token}` },
  });
}

/** Сколько дней собрано по проекту. Ряд приходит с сервера, не выдумывается. */
async function collectedDays(): Promise<number> {
  const api = await clientApi();
  const res = await api.get(`/api/v1/me/projects/${box.projectId}/report`);
  const days = ((await res.json()).by_day ?? []) as unknown[];
  await api.dispose();
  return days.length;
}

/** Точек на линии — по одной на день окна. */
/**
 * Сколько точек нарисовано на линии.
 *
 * Подпись графика у менеджера и у заказчика разная — «Просмотры
 * нарастающим итогом» и «Накопленные просмотры проекта: N», — поэтому
 * ищем ломаную по самому графику, а не по его имени: проверяется ряд, а
 * не заголовок.
 */
async function pointsOn(stats: Locator): Promise<number> {
  const points = (await stats.locator('svg polyline.line').first().getAttribute('points')) ?? '';
  return points.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Общее тело: кнопки есть, и каждая меняет ряд.
 *
 * Ряд короче тридцати дней специально: «30 дней» показывает всё
 * собранное, «7 дней» — последнюю неделю, и разница видна числом точек.
 */
async function checksRangeSwitch(page: Page, all: number, root = 'app-project-stats'): Promise<void> {
  const stats = page.locator(root);
  await expect(stats).toBeVisible({ timeout: 15_000 });

  const week = stats.getByRole('button', { name: '7 дней' });
  const month = stats.getByRole('button', { name: '30 дней' });
  await expect(week, 'переключатель стоит у самого графика').toBeVisible();
  await expect(month).toBeVisible();

  // По умолчанию — месяц: период проекта меряется месяцем, и на нём
  // видно, как ролик набирает после выхода.
  expect(await pointsOn(stats), 'по умолчанию показан весь собранный ряд').toBe(all);

  await week.click();
  await expect.poll(() => pointsOn(stats), { message: 'неделя обязана укоротить ряд' }).toBe(7);

  // И обратно: выбор живёт, пока смотрят, и отменяется тем же кликом.
  await month.click();
  await expect.poll(() => pointsOn(stats)).toBe(all);
}

test('менеджер переключает глубину графика', async ({ context, page }) => {
  const all = await collectedDays();
  expect(all, 'мир обязан собрать больше недели: иначе кнопки нечему менять').toBeGreaterThan(7);
  expect(all, 'и меньше месяца: иначе «7» и «30» дают один и тот же хвост').toBeLessThan(30);

  await signIn(context, 'manager');
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Статистика');
  await checksRangeSwitch(page, all);
});

test('заказчик переключает глубину графика на своей карточке', async ({ context, page }) => {
  const all = await collectedDays();
  await signIn(context, 'client');
  await page.goto(`/me/projects/${box.projectId}`);
  await openClientTab(page, 'Статистика');
  // У заказчика график живёт прямо в карточке проекта, своим блоком:
  // отдельного виджета статистики на этом экране нет.
  await checksRangeSwitch(page, all, '.panel:has(app-line-chart)');
});

test('админ в чужом проекте видит тот же переключатель', async ({ context, page }) => {
  // Админ смотрит менеджерскую карточку, и «у менеджера есть, а у меня
  // нет» здесь было бы не правом доступа, а забытыми кнопками.
  const all = await collectedDays();
  await signIn(context, 'admin');
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Статистика');
  await checksRangeSwitch(page, all);
});
