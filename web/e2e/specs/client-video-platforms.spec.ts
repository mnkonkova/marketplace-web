import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, STATS } from '../fixtures/world';
import { openClientTab } from '../fixtures/ui';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Заказчик смотрит ролик по площадкам.
 *
 * Ролик один и тот же — разница только в площадке, и ради этой разницы
 * заказчик страницу и открывает. Данные для неё уже загружены отчётом:
 * когда-то страница показывала пять бейджей без ссылок и без цифр.
 *
 * Раскрытия больше нет: разбор по площадкам стоит в карточке сразу,
 * кнопками «открыть и проверить» — по одной на площадку, с её цифрой
 * внутри. Значки в 26 пикселей не говорили ни куда ведут, ни сколько
 * там просмотров, и палец по ним промахивался. Поэтому здесь
 * проверяется не «раскрылось», а то, ради чего раскрытие заводили:
 * ссылка и число по каждой площадке, и площадка без ссылки, которая не
 * притворяется кнопкой.
 *
 * Здесь же — бейдж «N из 5 площадок». Он был зелёным всегда, и ролик,
 * вышедший на двух площадках из пяти, выглядел закрытым. Это не
 * косметика: именно такие ролики менеджер потом и дожимает.
 */
const grouped = (n: number) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s?'));

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
  box = await createSandbox('platforms');
});

test.afterAll(() => dropSandbox(box));

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.client] as const,
  );
  await page.goto(`/me/projects/${box.projectId}`);
});

/** Строка ролика в ленте заказчика. */
const videoRow = (page: Page) => page.locator('table.cards tbody tr').first();

test('ролик показывает ссылку и просмотры по каждой площадке', async ({ page }) => {
  await openClientTab(page, 'Ролики');
  const row = videoRow(page);
  await expect(row, 'вышедший ролик стоит в ленте').toBeVisible({ timeout: 15_000 });

  const plats = row.locator('.plat');
  await expect(plats, 'площадок пять — и ни одна не пропущена').toHaveCount(5);

  // Цифры площадок — те же, что собраны: сумма по ролику из них и
  // складывается, и расхождение здесь означает, что заказчик и менеджер
  // смотрят на разные числа. Число стоит рядом со значком, а не в
  // подсказке: на телефоне наводить нечем.
  const tiktok = plats.filter({ hasText: 'TT' });
  await expect(tiktok.locator('.v')).toHaveText(grouped(STATS.today.tiktok));
  await expect(tiktok).toHaveAttribute('href', /tiktok\.com/);
});

test('у полностью вышедшего ролика нет ни одной несданной площадки', async ({ page }) => {
  await openClientTab(page, 'Ролики');
  const row = videoRow(page);
  await expect(row).toBeVisible({ timeout: 15_000 });

  // «Вышел везде» — это отсутствие пустых значков, а не отдельная
  // плашка: пустая площадка нарисована пунктиром и молчит про
  // просмотры, и спутать её со сданной нельзя.
  await expect(row.locator('.plat')).toHaveCount(5);
  await expect(row.locator('.plat.nd'), 'все пять сданы').toHaveCount(0);
  await expect(row.locator('.plat[href]'), 'и каждая ведёт на ролик').toHaveCount(5);
});
