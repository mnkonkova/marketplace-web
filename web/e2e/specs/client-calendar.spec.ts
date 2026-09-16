import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab } from '../fixtures/ui';

/**
 * Календарь заказчика: когда что выходит.
 *
 * Единственное место, где заказчик видит план по датам, а не списком, — и
 * ломается оно бесшумно: сетка месяца рисуется всегда, просто без точек.
 * Пустой календарь выглядит как «в этом месяце ничего не запланировано»,
 * то есть как ответ, а не как потерянные данные. Разница между «ничего не
 * стоит» и «не доехало» на экране не видна вовсе.
 *
 * Поэтому сверяем нарисованное с тем, что отдала ручка: сколько дней
 * отмечено на сетке и совпадают ли они с днями из ответа. И проверяем,
 * что день раскрывается: точка без подписи говорит только «что-то есть».
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
  box = await createSandbox('calendar');
});

test.afterAll(() => dropSandbox(box));

interface CalendarDay {
  date: string;
  published: number;
  planned: number;
}

/** Дни текущего месяца с сервера: план строится там, а не в браузере. */
async function calendar(projectId: string): Promise<CalendarDay[]> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.client.access_token}` },
  });
  const month = new Date().toISOString().slice(0, 7);
  const res = await api.get(`/api/v1/me/projects/${projectId}/calendar?month=${month}`);
  const items = ((await res.json()).days ?? []) as CalendarDay[];
  await api.dispose();
  return items.filter((d) => d.published > 0 || d.planned > 0);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.client] as const,
  );
});

test('в календаре заказчика отмечены дни выкладок', async ({ page }) => {
  const days = await calendar(box.projectId);
  expect(days.length, 'мир обязан поставить выкладку в текущем месяце').toBeGreaterThan(0);

  await page.goto(`/me/projects/${box.projectId}`);
  await openClientTab(page, 'Календарь');
  const cal = page.locator('app-project-calendar');
  await expect(cal).toBeVisible({ timeout: 15_000 });

  // Отмеченных дней ровно столько, сколько отдала ручка. «Меньше» —
  // это потерянные даты, «больше» — придуманные, и оба случая на экране
  // выглядят одинаково правдоподобно.
  await expect(cal.locator('.cell.has')).toHaveCount(days.length);

  for (const day of days) {
    const num = String(Number(day.date.slice(8, 10)));
    const cell = cal.locator('.cell.has').filter({ hasText: new RegExp(`^${num}$`) });
    await expect(cell, `день ${day.date}`).toHaveCount(1);
  }
});

test('день в календаре раскрывается: что вышло и кто снимал', async ({ page }) => {
  const days = await calendar(box.projectId);
  const withVideo = days.find((d) => d.published > 0);
  expect(withVideo, 'посеянный ролик уже вышел').toBeTruthy();

  await page.goto(`/me/projects/${box.projectId}`);
  await openClientTab(page, 'Календарь');
  const cal = page.locator('app-project-calendar');
  await expect(cal).toBeVisible({ timeout: 15_000 });

  const num = String(Number(withVideo!.date.slice(8, 10)));
  await cal
    .locator('.cell.has')
    .filter({ hasText: new RegExp(`^${num}$`) })
    .click();

  // Точка без подписи говорит только «что-то есть». Под сеткой — что
  // именно: сколько вышло и чей это ролик.
  const picked = cal.locator('.picked');
  await expect(picked).toBeVisible();
  await expect(picked).toContainText(`вышло ${withVideo!.published}`);
  await expect(cal.locator('.picked-items')).toContainText(box.creator.name);
});
