import { test, expect, type Locator, type Page, request as pwRequest } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

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
async function report(): Promise<{
  er_without_shares?: boolean;
  shares?: number;
  by_platform?: unknown[];
}> {
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
  // Отклик стоит своей плиткой в сводке: число, разбор на лайки,
  // комментарии и репосты — и оговорка тут же, если репостов нет.
  const react = page.locator('.panel').filter({ hasText: 'Вовлечённость · ER' });
  await expect(react, 'отклик показан плиткой').toBeVisible({ timeout: 15_000 });
  await expect(react.locator('.kpi .v'), 'это процент, а не прочерк').toContainText('%');

  // Разбор на составляющие — вместо оговорки словами.
  //
  // Оговорку с карточки заказчика убрали намеренно (сентябрь 2026): на
  // экране, который показывают начальству, сноска про недополученные
  // репосты читалась как оправдание. Разбор её заменяет и говорит то же
  // самое честнее: видно, из чего собран процент, и видно, что репостов
  // в нём нет вовсе. Проверяем именно это — иначе «убрали оговорку»
  // однажды превратится в «убрали и разбор», и процент останется без
  // объяснения.
  await expect(react, 'видно, из чего собран процент').toContainText('лайков');
  await expect(react).toContainText('комм.');
  if (r.shares === undefined || r.shares === 0) {
    await expect(react, 'репостов нет — и строки про них нет').not.toContainText('репостов');
  }
});

test('в отчёте менеджера оговорка та же, а не только у заказчика', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto(`/manager/projects/${box.projectId}`);
  // У менеджера ER живёт в таблице роликов: колонка ER сводки площадок и
  // режим «ER» самой таблицы.
  await page.locator('.secnav button', { hasText: 'Ролики' }).click();
  const vm = page.locator('app-video-matrix');
  await expect(vm).toBeVisible({ timeout: 15_000 });
  await vm.getByRole('button', { name: 'ER', exact: true }).click();
  await expect(shown(vm)).not.toHaveCount(0);

  // Менеджер объясняет заказчику цифры и не может делать это по числу,
  // про которое сам не знает, что оно занижено.
  expect(await stars(vm).count()).toBe(await shown(vm).count());
});

