import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab } from '../fixtures/ui';

/**
 * Взгляд заказчика: условия и деньги. Проверяем то, что видно человеку,
 * а не то, что вернуло API, — суммы приходят в копейках, и ошибка в
 * делении на сто выглядит как лишние два нуля в счёте.
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.client] as const,
  );
});

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
  box = await createSandbox('clproject');
});

test.afterAll(() => dropSandbox(box));

test('клиент видит проект и условия в рублях, а не в копейках', async ({ page }) => {
  await page.goto(`/me/projects/${box.projectId}`);

  await expect(page.getByText(box.title).first()).toBeVisible({ timeout: 15_000 });
  // Условия лежат во вкладке «Деньги»: карточка открывается тем, ради
  // чего заказчик заходит чаще всего, — роликами.
  await openClientTab(page, 'Деньги');

  // Деньги приходят в КОПЕЙКАХ, а показываются в рублях: тысяча рублей
  // за ролик — это 100 000 в ответе сервера. Ошибка здесь тихая: число
  // на экране выглядит как настоящая сумма, просто в сто раз больше.
  //
  // Проверяем по фиксу за ролик, а не по окладу за месяц: оклад ушёл с
  // этого экрана вместе со старой моделью (сентябрь 2026), и цена
  // месяца теперь складывается из роликов.
  const body = page.locator('body');
  await expect(body).toContainText(/1\s?000\s?₽/);
  await expect(body, 'копейки на экран не попадают').not.toContainText(/100\s?000\s?₽/);
});

/**
 * Страница проекта и виджет грузили одни и те же пять ручек: страница —
 * своей копией, которая нигде не рисовалась, виджет — для отрисовки.
 * Каждое открытие проекта било по каждой ручке дважды, и заметить это
 * можно было только в логе сервера.
 */
test('данные проекта запрашиваются по одному разу', async ({ page }) => {
  const calls = new Map<string, number>();
  page.on('request', (r) => {
    const m = r
      .url()
      .match(/\/me\/projects\/[^/]+\/(videos|report|calendar|notifications|billing)/);
    if (m) calls.set(m[1], (calls.get(m[1]) ?? 0) + 1);
  });

  await page.goto(`/me/projects/${box.projectId}`);
  await expect(page.getByText(box.title).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  expect(calls.get('videos'), 'лента роликов').toBe(1);
  expect(calls.get('report'), 'отчёт').toBe(1);
  expect(calls.get('calendar'), 'календарь').toBe(1);
  expect(calls.get('notifications'), 'настройки уведомлений').toBe(1);
});

/**
 * Карточка проекта на телефоне: страница не уезжает вбок.
 *
 * Жалоба звучала как «в роликах футер уходит», и футер был ни при чём.
 * Полоса разделов внизу прибита к ЭКРАНУ (position: fixed) и шириной с
 * экран, а страница на вкладке «Ролики» была шире экрана на 175 px:
 * ряд из пяти площадок с цифрами не переносился, распирал карточку
 * ролика, а за ней и весь документ. Стоило отвести палец вправо — и
 * полоса кончалась там, где кончался экран, то есть «уходила».
 *
 * Поэтому проверка не про футер, а про то, из-за чего он уезжал:
 * горизонтальной прокрутки у документа быть не должно НИ НА ОДНОЙ
 * вкладке. Проверяем все четыре: сломать ширину может любая, а заметно
 * это только на той, где сломали.
 */
test.describe('на телефоне', () => {
  const PHONE = { width: 390, height: 844 };

  test('ни один раздел не уводит страницу вбок, и полоса разделов на месте', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(`/me/projects/${box.projectId}`);
    await expect(page.locator('app-client-turnkey-project')).toBeVisible({ timeout: 20_000 });

    // Полоса разделов — единственная навигация на телефоне: наверху
    // вкладки спрятаны словарём (_prmarket-touch.scss).
    const bar = page.locator('app-prmarket-tabbar');
    await expect(bar, 'полоса разделов нарисована').toBeVisible();

    for (const name of ['Сводка', 'Ролики', 'Календарь', 'Деньги']) {
      await bar.locator('button', { hasText: name }).click();
      // Ждём саму вкладку, а не таймер: раздел рисуется по клику, и
      // мерить ширину недорисованного значит мерить не то.
      await expect(bar.locator(`button[aria-current="page"]`)).toContainText(name);
      await page.waitForTimeout(300);

      const room = await page.evaluate(() => {
        const de = document.documentElement;
        return { scroll: de.scrollWidth, client: de.clientWidth };
      });
      expect(room.scroll, `раздел «${name}» помещается в экран`).toBeLessThanOrEqual(room.client);
    }
  });
});
