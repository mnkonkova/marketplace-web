import { test, expect, type Page, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Что уезжает в браузер вместе с деньгами.
 *
 * Самая тихая поломка из всех, которые тут проверяются: лишнее поле в
 * ответе не видно ни на экране, ни в отчёте о падении — интерфейс его и
 * не рисовал никогда. Маржа площадки, выплата креатору и цепочка
 * периодов доезжают до заказчика в открытом виде, и узнать об этом можно
 * только из вкладки «Сеть», в которую никто не смотрит. Поэтому смотрим
 * сюда мы: специя читает ОТВЕТЫ, а не разметку.
 *
 * Именно поэтому проверка живёт в браузере, а не в сквозных тестах API:
 * серверный тест сторожит ручку, которую знает, а страница может позвать
 * любую — и заодно ту, про которую никто не помнит, что она отдаёт.
 *
 * Чего здесь НЕ запрещено: `creator_user_id` и `creator_name` в ответе
 * заказчику. Он платит за «Команду периода» и вправе видеть, кто в ней
 * был. Тайна — не имя, а вторая сторона сделки: сколько из его денег
 * получит человек и сколько оставит себе площадка.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

const signIn = (
  context: import('@playwright/test').BrowserContext,
  role: 'manager' | 'creator' | 'client' | 'admin',
) =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

interface Captured {
  /** Путь без хоста и без query: он и попадает в текст падения. */
  path: string;
  body: unknown;
}

/**
 * Копить разобранные ответы API, пока страница работает.
 *
 * Тело читаем отложенно: обработчик `response` синхронный, а `json()` —
 * нет, и без общего ожидания половина ответов осталась бы неразобранной.
 * Ждём в два захода: разбор первой пачки успевает породить вторую.
 */
function watchApi(page: Page) {
  const captured: Captured[] = [];
  const pending: Promise<unknown>[] = [];
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/v1/')) return;
    pending.push(
      res.json().then(
        (body) => captured.push({ path: url.pathname, body }),
        // Не JSON или тело уже недоступно: смотреть в таком ответе нечего.
        () => undefined,
      ),
    );
  });
  return async function settled(): Promise<Captured[]> {
    await Promise.all([...pending]);
    await Promise.all([...pending]);
    return captured;
  };
}

/** Все ключи ответа, как бы глубоко они ни лежали. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      keysOf(nested, into);
    }
  }
  return into;
}

/** «margin в /api/v1/me/projects/…/billing» — по одной строке на находку. */
function leaks(captured: Captured[], forbidden: readonly string[]): string[] {
  const found: string[] = [];
  for (const item of captured) {
    const keys = keysOf(item.body);
    for (const key of forbidden) if (keys.has(key)) found.push(`${key} в ${item.path}`);
  }
  return found;
}

/**
 * Креаторская сторона сделки. Заказчик платит по своим ставкам, и
 * сколько из этих денег доходит до человека — не его дело: на этой
 * разнице живёт площадка.
 */
const OTHER_SIDE = [
  'payouts',
  'margin',
  'payout_salary',
  'payout_deduction',
  'payout_views_bonus',
  'payout_click_bonus',
  'payout_total',
  'creator_salary_per_month',
  'creator_rate_per_1000_views',
  'creator_rate_per_1000_views_over',
] as const;

/** Перенос ступени по креаторской стороне и внутренняя цепочка периодов. */
const CLIENT_FORBIDDEN = [
  ...OTHER_SIDE,
  'carry_in_creator',
  'carry_out_creator',
  'prev_period_id',
] as const;

test('заказчику не приезжают ни выплаты креаторам, ни маржа, ни цепочка периодов', async ({
  context,
  page,
}) => {
  await signIn(context, 'client');
  const settled = watchApi(page);

  // Карточка проекта и список: деньги показывают обе, а запрашивает их
  // одна — но лишнее поле всё равно ищем в обоих заходах, иначе оно
  // переедет вместе с первой же новой плашкой.
  await page.goto(`/me/projects/${world().projectId}`);
  await expect(page.getByText('PetFlat · UGC (e2e)').first()).toBeVisible({ timeout: 15_000 });
  await page.goto('/me/projects');
  await expect(page.getByText('PetFlat · UGC (e2e)').first()).toBeVisible({ timeout: 15_000 });

  const captured = await settled();
  const billing = captured.filter((c) => /^\/api\/v1\/me\/projects\/[^/]+\/billing$/.test(c.path));
  expect(billing.length, 'страница обязана спросить деньги проекта').toBeGreaterThan(0);

  expect(leaks(captured, CLIENT_FORBIDDEN), 'заказчику отдали чужую сторону сделки').toEqual([]);

  // Идентификатор периода запрещаем точечно, а не по всему ответу:
  // у начислений свои id, и они нужны экрану. Внутренняя цепочка
  // переносов — наша механика, и снаружи её быть не должно.
  for (const answer of billing) {
    const period = (answer.body as { period?: Record<string, unknown> }).period;
    expect(period, 'в ответе про деньги должен быть период').toBeTruthy();
    expect(Object.keys(period!), 'идентификатор периода у заказчика').not.toContain('id');
  }
});

test('креатор в своём кабинете не видит ни клиентских сумм, ни чужих людей', async ({
  context,
  page,
}) => {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.creator.access_token}` },
  });
  const meId = (await (await api.get('/api/v1/me')).json()).user_id as string;
  await api.dispose();

  await signIn(context, 'creator');
  const settled = watchApi(page);

  await page.goto(`/me/creator/projects/${world().historyProjectId}`);
  // Ждём сам блок, а не заголовок в нём: заголовок — вопрос подачи, и
  // специя про утечки не должна падать от того, что его переписали.
  await expect(page.locator('app-creator-ladder')).toBeVisible({ timeout: 15_000 });

  const captured = await settled();
  const earnings = captured.filter((c) => c.path.endsWith('/earnings'));
  expect(earnings.length, 'кабинет обязан спросить заработок').toBeGreaterThan(0);

  // Клиентская сторона для креатора — такая же коммерческая тайна, как
  // его выплата для заказчика: по ней видно, сколько на нём заработали.
  expect(
    leaks(captured, [...OTHER_SIDE, 'carry_in_client', 'carry_out_client', 'prev_period_id']),
    'креатору отдали клиентскую сторону сделки',
  ).toEqual([]);

  // Чужих людей в кабинете нет вовсе: ни в начислениях, ни в ориентире.
  // Ориентир по проекту приходит обезличенным числом — как только рядом
  // с ним появится чей-то идентификатор, это уже не агрегат.
  const strangers: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'creator_user_id' && nested !== meId) strangers.push(`${path}.${key}`);
      walk(nested, `${path}.${key}`);
    }
  };
  for (const answer of captured) walk(answer.body, answer.path);
  expect(strangers, 'в кабинете креатора нашёлся чужой идентификатор').toEqual([]);
});

test('список проектов специалиста — список, а не выгрузка карточек', async ({ context, page }) => {
  await signIn(context, 'creator');
  const settled = watchApi(page);

  await page.goto('/me/creator/projects');
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible({ timeout: 15_000 });

  const captured = await settled();
  const list = captured.filter((c) => c.path === '/api/v1/me/creator/projects');
  expect(list.length, 'страница обязана спросить список').toBeGreaterThan(0);

  // Заметки менеджера — его рабочая запись по проекту, и в списке она не
  // нужна никому: бриф креатор читает в карточке, куда его кладут
  // осознанно. Лишнее поле в списке замечают не раньше, чем в него
  // положат что-нибудь не для чужих глаз.
  expect(leaks(list, ['notes']), 'в списке проектов специалиста нашлись заметки').toEqual([]);
});

test('смета заказа не показывает заказчику креаторские ставки', async ({ context, page }) => {
  await signIn(context, 'client');
  const settled = watchApi(page);

  await page.goto('/me/projects');
  await page.getByRole('button', { name: 'Под ключ' }).click();
  await expect(page.getByRole('heading', { name: 'Что делаем?' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.kind.k1').click();
  await expect(page.locator('.ccard').first()).toBeVisible({ timeout: 15_000 });

  // Смета уходит с задержкой после выбора — ждём именно её ответ, иначе
  // проверять было бы нечего и специя зеленела бы впустую.
  const [estimate] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/me/orders/estimate') && r.request().method() === 'POST',
    ),
    page.locator('.ccard:not([disabled])').first().click(),
  ]);
  expect(estimate.ok(), 'смета должна посчитаться').toBeTruthy();

  const captured = await settled();
  const quotes = captured.filter((c) => c.path.endsWith('/me/orders/estimate'));
  expect(quotes.length, 'страница обязана спросить смету').toBeGreaterThan(0);

  // В смете лежит версия правил целиком — тот самый объект, у которого
  // есть обе стороны. Заказчику называют его цену; во сколько заказ
  // обойдётся площадке, в предложении клиенту делать нечего.
  expect(leaks(quotes, OTHER_SIDE), 'в смете нашлась креаторская сторона тарифа').toEqual([]);
});
