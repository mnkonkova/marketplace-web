import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { openManagerTab } from '../fixtures/ui';
import { call, createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Деньги периода, разложенные между ДВУМЯ креаторами.
 *
 * Цена периода — величина проекта: ступень берётся общим объёмом, фикс
 * платится за каждый вышедший ролик. Строка человека отвечает на другой
 * вопрос — «сколько из этого моё», — и делится каждая часть по своему
 * основанию: фикс по роликам, виральный хвост по просмотрам СВЕРХ
 * порога.
 *
 * При одном креаторе эти правила неразличимы: любая доля равна единице,
 * и «разделили не по тому основанию» не видно ни на экране, ни в тесте.
 * Все остальные денежные специи работают на одном человеке — поэтому
 * эта существует отдельно.
 *
 * Проверяем НА ЭКРАНЕ МЕНЕДЖЕРА, а не в ответе API: арифметику стережёт
 * бэкенд (tests/integration, TestPeriodSplitBetweenTwoCreators), а здесь
 * вопрос другой — доезжают ли обе строки до таблицы и сходится ли их
 * сумма с итогом под ней. Итог считает сервер, и разойтись он может
 * молча.
 */
let box: Sandbox;

/** Фикс за ролик: заказчик платит 1000 ₽, креатор получает 500 ₽. */
const FEE = 100_000;
const CREATOR_FEE = 50_000;

test.beforeAll(async () => {
  box = await createSandbox('twocrew', { shape: 'crew', creators: 2, ownClient: true });

  // Тариф задаём сами, а не берём из прайса площадки: проверяются
  // ПРАВИЛА деления, и они должны считаться от известных чисел, а не от
  // того, какую версию прайса выпустили последней.
  await call(box, 'manager', 'put', `/api/v1/manager/projects/${box.projectId}/billing`, {
    fee_per_video: FEE,
    creator_fee_per_video: CREATOR_FEE,
    salary_per_month: 0,
    creator_salary_per_month: null,
    rate_per_1000_views: 0,
    creator_rate_per_1000_views: null,
    // Виральный хвост: порог на ролик и ставка сверх него. Его набрал
    // только второй — на нём и проверяется, что хвост не растекается.
    bonus_views_threshold: 1_000_000,
    rate_per_1000_views_over: 600,
    steps: [{ from_views: 300_000, client_fee: 4_500_000, creator_fee: 2_800_000 }],
    guarantee_views: null,
    subscriber_rate: null,
    creator_subscriber_rate: null,
  });
});

test.afterAll(() => dropSandbox(box));

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
});

/** Деньги строки: из ячейки «12 000 ₽» — число 1 200 000 копеек. */
function kopecks(text: string): number {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) * 100 : 0;
}

/**
 * Номер столбца по подписи, а не по счёту.
 *
 * Столбцы таблицы меняются вместе с моделью тарифа — «Оклад» стал
 * «Фиксом», когда фикс начали считать за ролик, — и спека, считающая
 * ячейки от края, ломается от любой такой правки, не сказав, что
 * сломалось на самом деле.
 */
async function column(page: Page, title: RegExp): Promise<number> {
  // innerText отдаёт текст ПОСЛЕ text-transform: в шапке он в верхнем
  // регистре. Сравниваем без учёта регистра, иначе спека ловит
  // оформление вместо подписи.
  const heads = await page.locator('.sec-pay table.cards thead th').allInnerTexts();
  const i = heads.findIndex((h) => title.test(h.trim().toLowerCase()));
  expect(i, `столбец ${title} есть в таблице: ${heads.join(' | ')}`).toBeGreaterThanOrEqual(0);
  return i;
}

test('в начислениях две строки, и их сумма сходится с итогом периода', async ({ page }) => {
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Начисления');

  // Пересчёт: до него период показан предварительным расчётом, а
  // проверять надо сохранённые строки — те, по которым платят.
  await page
    .getByRole('button', { name: 'Пересчитать' })
    .first()
    .click();
  await expect(page.locator('.ant-message')).toContainText('Пересчитали', { timeout: 15_000 });

  const rows = page.locator('.sec-pay table.cards tbody tr');
  await expect(rows, 'в составе двое — и строк тоже две').toHaveCount(2);

  // Обе фамилии на месте: одна строка на двоих означала бы, что кому-то
  // не заплатят вовсе.
  const body = page.locator('.sec-pay table.cards');
  await expect(body).toContainText(box.creators[0].name);
  await expect(body).toContainText(box.creators[1].name);

  // Итог под таблицей считает СЕРВЕР, и сойтись он обязан со строками
  // копейка в копейку: два разных числа на одном экране — худшее, что
  // может случиться на созвоне.
  const totalCol = await column(page, /итого/);
  const cell = async (row: number, col: number): Promise<number> =>
    kopecks(await rows.nth(row).locator('td').nth(col).innerText());

  const first = await cell(0, totalCol);
  const second = await cell(1, totalCol);
  const total = kopecks(
    await page.locator('.sec-pay table.cards tfoot td').nth(totalCol).innerText(),
  );
  expect(first + second, 'сумма строк равна итогу периода').toBe(total);
});

test('фикс делится по роликам, а виральный хвост — по просмотрам сверх порога', async ({
  page,
}) => {
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Начисления');
  await expect(page.locator('.sec-pay table.cards tbody tr')).toHaveCount(2, { timeout: 15_000 });

  // Строки ищем по имени, а не по порядку: порядок — вопрос подачи.
  const rowOf = (name: string) =>
    page.locator('.sec-pay table.cards tbody tr').filter({ hasText: name });

  const cellText = async (name: string, col: number): Promise<string> =>
    rowOf(name).locator('td').nth(col).innerText();

  const fixCol = await column(page, /фикс|оклад/);
  const bonusCol = await column(page, /бонус/);

  // Фикс — за РОЛИК: у первого их два, у второго один. По просмотрам
  // это деление дало бы 12% и 88%, то есть работу оплатили бы по удаче.
  expect(kopecks(await cellText(box.creators[0].name, fixCol))).toBe(2 * CREATOR_FEE);
  expect(kopecks(await cellText(box.creators[1].name, fixCol))).toBe(CREATOR_FEE);

  // Хвост зарабатывают просмотры СВЕРХ порога, и набрал их только
  // второй. Ровный исполнитель доли чужой виральности не получает.
  expect(
    kopecks(await cellText(box.creators[0].name, bonusCol)),
    'первый порога не переходил',
  ).toBe(0);
  expect(
    kopecks(await cellText(box.creators[1].name, bonusCol)),
    'у второго ролик залетел — хвост его',
  ).toBeGreaterThan(0);
});
