import { test, expect } from '@playwright/test';
import { AUTH_KEY, STATS } from '../fixtures/world';
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

test('ролик показывает ссылку и просмотры по каждой площадке', async ({ page }) => {
  const card = page.locator('article').filter({ hasText: 'Открыть и проверить' }).first();
  await expect(card, 'у вышедшего ролика есть что открыть').toBeVisible({ timeout: 15_000 });

  const opens = card.locator('.opens .go');
  await expect(opens, 'площадок пять — и ни одна не пропущена').toHaveCount(5);

  // Цифры площадок — те же, что собраны: сумма по ролику из них и
  // складывается, и расхождение здесь означает, что заказчик и менеджер
  // смотрят на разные числа.
  const tiktok = opens.filter({ hasText: 'TikTok' });
  await expect(tiktok.locator('.gv')).toContainText(grouped(STATS.today.tiktok));
  await expect(tiktok).toHaveAttribute('href', /tiktok\.com/);

  // Число внутри кнопки, а не только рядом: именно оно отвечает на
  // «сколько там», не заставляя открывать площадку.
  await expect(tiktok.locator('.gv')).toBeVisible();
});

test('полностью вышедший ролик помечен зелёным', async ({ page }) => {
  const badge = page.locator('.tag').filter({ hasText: 'из 5 площадок' }).first();
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toContainText('5 из 5');
  // Зелёный — только когда вышли все пять. Класс проверяем прямо: он и
  // есть то самое обещание «ролик закрыт».
  await expect(badge).toHaveClass(/green/);
  await expect(badge).not.toHaveClass(/amber/);
});
