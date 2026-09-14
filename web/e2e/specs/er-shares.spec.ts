import { test, expect, type Locator, type Page, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

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

const signIn = (context: import('@playwright/test').BrowserContext, role: 'manager' | 'client') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

/** Отчёт заказчика: из него видно, отдала ли хоть одна площадка репосты. */
async function report(): Promise<{ er_without_shares?: boolean; by_platform?: unknown[] }> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.client.access_token}` },
  });
  const res = await api.get(`/api/v1/me/projects/${world().projectId}/report`);
  const body = await res.json();
  await api.dispose();
  return body;
}

/** Показанные значения ER — те, где стоит число, а не прочерк. */
const shown = (where: Page | Locator) => where.locator('app-er-value:has(.num)');

/** Звёздочки рядом с ними. */
const stars = (where: Page | Locator) => where.locator('app-er-value .star');

test('пока репостов не отдаёт никто, звёздочка стоит у каждого показанного ER', async ({
  context,
  page,
}) => {
  const r = await report();
  expect(r.er_without_shares, 'посев намеренно не кладёт репосты: без этого проверять нечего').toBe(
    true,
  );

  await signIn(context, 'client');
  await page.goto(`/me/projects/${world().projectId}`);
  await expect(shown(page).first()).toBeVisible({ timeout: 15_000 });

  // Раскрываем ролик: разбор по площадкам — второе место, где ER
  // сравнивают между собой, и именно там занижение всего заметнее.
  await page.getByRole('button', { name: 'По площадкам' }).first().click();
  await expect(shown(page).nth(1)).toBeVisible();

  const values = await shown(page).count();
  expect(values, 'на экране должно быть несколько ER: итог и площадки').toBeGreaterThan(1);
  expect(await stars(page).count(), 'звёздочка обязана стоять у каждого').toBe(values);

  // Объяснение — по наведению, а не догадкой по символу: «*» рядом с
  // процентом читается как сноска, которой на странице нет.
  await expect(stars(page).first()).toHaveAttribute('title', /без репостов/);
});

test('в отчёте менеджера оговорка та же, а не только у заказчика', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto(`/manager/projects/${world().projectId}`);
  await page.getByRole('button', { name: /^Статистика/ }).click();

  const stats = page.locator('app-project-stats');
  await expect(stats).toBeVisible({ timeout: 15_000 });
  await expect(shown(stats)).not.toHaveCount(0);

  // Менеджер объясняет заказчику цифры и не может делать это по числу,
  // про которое сам не знает, что оно занижено.
  expect(await stars(stats).count()).toBe(await shown(stats).count());
});
