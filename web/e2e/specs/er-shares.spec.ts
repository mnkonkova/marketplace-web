import { test, expect, type Locator, type Page, request as pwRequest } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/**
 * Звёздочка у вовлечённости там, где репостов не отдали.
 *
 * ER — это (лайки + комментарии + репосты) ÷ просмотры. Репосты отдают не
 * все площадки, и посчитанный без них ER занижен. Молча сравнивать «с
 * репостами» с «без репостов» нельзя: числа выглядят одинаково
 * убедительно, а разница между ними — не погрешность, а другая формула.
 * Поэтому оговорка стоит у самой цифры, а не сноской внизу экрана, — и
 * ломается она тише всего: пропавшая звёздочка ничего не ломает в
 * вёрстке, просто число начинает врать с честным видом.
 *
 * Сейчас репостов нет ни на одной площадке — их не кладёт посев, и
 * сборщик локально не ходил. Значит звёздочка обязана стоять у КАЖДОГО
 * показанного ER, и это же и проверяем. Когда сборщик пройдёт первый раз
 * и заполнит колонку репостов, ожидание изменится: звёздочка останется
 * только там, где площадка их не отдала, и «у всех» превратится в «у
 * тех, у кого er_without_shares». Признак для этого и читаем из ответа —
 * специя сверяет экран с данными, а не с сегодняшним состоянием стенда.
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
  box = await createSandbox('ershares');
});

test.afterAll(() => dropSandbox(box));

const signIn = (context: import('@playwright/test').BrowserContext, role: 'manager' | 'client') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );

/** Отчёт заказчика: из него видно, отдала ли хоть одна площадка репосты. */
async function report(): Promise<{ er_without_shares?: boolean; by_platform?: unknown[] }> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.client.access_token}` },
  });
  const res = await api.get(`/api/v1/me/projects/${box.projectId}/report`);
  const body = await res.json();
  await api.dispose();
  return body;
}

/** Показанные значения ER — те, где стоит число, а не прочерк. */
const shown = (where: Page | Locator) => where.locator('app-er-value:has(.num)');

/** Звёздочки рядом с ними. */
const stars = (where: Page | Locator) => where.locator('app-er-value .star');

test('заказчику про занижённый ER сказано словами рядом с числом', async ({ context, page }) => {
  const r = await report();
  expect(r.er_without_shares, 'посев намеренно не кладёт репосты: без этого проверять нечего').toBe(
    true,
  );

  await signIn(context, 'client');
  await page.goto(`/me/projects/${box.projectId}`);

  // ER у заказчика теперь ОДИН и стоит в строке отклика: лайки,
  // комментарии и ER — не три показателя, а один разложенный, и по
  // площадкам он больше не разбирается. Звёздочка с подсказкой по
  // наведению вместе с этим ушла — и правильно: на телефоне наводить
  // нечем, а «*» рядом с процентом читается как сноска, которой на
  // странице нет.
  const react = page.locator('.answer .half.views .react');
  await expect(react, 'отклик показан одной строкой').toBeVisible({ timeout: 15_000 });
  const er = react.locator('.react-row .r').filter({ hasText: 'от просмотров' });
  await expect(er, 'ER стоит в строке отклика').toHaveCount(1);
  await expect(er.locator('.rv'), 'и это процент, а не прочерк').toContainText('%');

  // Оговорка — СЛОВАМИ и в том же блоке, что число. Занижённый ER без
  // неё заказчик сравнивает с чужими цифрами и делает вывод о работе.
  await expect(react.locator('.say'), 'занижение объяснено рядом с числом').toContainText(
    'Репосты площадки не отдают',
  );
});

test('в отчёте менеджера оговорка та же, а не только у заказчика', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Статистика');

  const stats = page.locator('app-project-stats');
  await expect(stats).toBeVisible({ timeout: 15_000 });
  await expect(shown(stats)).not.toHaveCount(0);

  // Менеджер объясняет заказчику цифры и не может делать это по числу,
  // про которое сам не знает, что оно занижено.
  expect(await stars(stats).count()).toBe(await shown(stats).count());
});
