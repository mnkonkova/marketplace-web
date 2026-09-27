import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, seedPublicationStats } from '../fixtures/world';
import { callAs, createSandbox, dropProject, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab } from '../fixtures/ui';

/**
 * Проект «бренд под ключ»: план выкладок есть, людей нет.
 *
 * Юнит-специи разметку не проверяют: в двадцати восьми из них шаблон
 * выброшен намеренно. Карточка менеджера при этом целиком собрана из
 * секций, и «блок выключен» здесь значит «секции нет в разметке» — то
 * есть ровно то, чего класс не видит. Поэтому проверяем экраном:
 *
 *  - менеджер ведёт такой проект руками: ставит дату, вставляет адрес,
 *    называет стоимость и видит СПВ;
 *  - секций, которых у вида нет — проверки, чек-листа, состава,
 *    начислений, — на экране нет вовсе. Пустая таблица «Состав» читается
 *    как «ещё никого не добавили», а здесь его не будет никогда;
 *  - заказчик открывает карточку проекта, а не воронку, и видит ролик
 *    без подписи «чей».
 */
let box: Sandbox;
/** Проект нужного вида. Песочница заводит «креаторов под ключ», и он тут нужен только ради людей. */
let brandId = '';
let brandTitle = '';

test.beforeAll(async () => {
  box = await createSandbox('brand', { shape: 'empty', ownClient: true });
  brandTitle = `Бренд ${box.tag} (e2e-sandbox)`;

  // Проект заводим настоящей ручкой и тем же телом, что шлёт форма: вид
  // задаётся при создании, и подменять его в базе значило бы проверять
  // экран на состоянии, которого приложение само не создаёт.
  const project = await callAs(box.manager, 'post', '/api/v1/manager/projects', {
    kind: 'brand_turnkey',
    title: brandTitle,
    client_user_id: box.client.userId,
    notes: 'Ролики выходят с аккаунтов бренда',
    is_test: true,
  });
  brandId = project.id as string;

  // Пачка без креаторов — норма для этого вида: даты есть, поручать их
  // некому.
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const batch = await callAs(
    box.manager,
    'post',
    `/api/v1/manager/projects/${brandId}/publications/batch`,
    { dates: [yesterday] },
  );
  const pubId = batch.items[0].id as string;

  // Ссылку вставляет менеджер: креаторской сдачи у этого вида нет.
  await callAs(box.manager, 'put', `/api/v1/manager/publications/${pubId}/links/tiktok`, {
    url: `https://www.tiktok.com/@brand/video/70${Date.now() % 100000}`,
  });
  seedPublicationStats(pubId);
});

test.afterAll(() => {
  if (brandId) dropProject(brandId);
  dropSandbox(box);
});

function signIn(page: Page, role: 'manager' | 'client') {
  return page
    .context()
    .addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions[role]] as const,
    );
}

test.describe('менеджер', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'manager'));

  test('ведёт проект без креаторов: план и ссылки есть, проверки и состава нет', async ({
    page,
  }) => {
    await page.goto(`/manager/projects/${brandId}`);

    // Карточка та же, что у «креаторов под ключ»: второго почти такого
    // же виджета для нового вида заводить не стали.
    await expect(page.locator('.sec-plan')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sec-links')).toBeVisible();
    await expect(page.locator('.sec-stats')).toBeVisible();

    // А этих секций нет в разметке вовсе — не спрятаны, а отсутствуют.
    await expect(page.locator('.sec-review')).toHaveCount(0);
    await expect(page.locator('.sec-team .roster-btn')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Начисления', exact: false })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Чек-лист проекта' })).toHaveCount(0);

    // Аккаунты остаются: с них ролики и выходят.
    await expect(page.locator('.sec-team')).toBeVisible();

    // Тумблер черновика уходит вместе с креаторами: согласовывать
    // черновик не с кем.
    await expect(
      page.locator('.switchrow', { hasText: 'Этап согласования черновика' }),
    ).toHaveCount(0);
  });

  test('называет стоимость проекта и видит цену тысячи просмотров', async ({ page }) => {
    await page.goto(`/manager/projects/${brandId}`);
    const input = page.locator('[data-test="project-cost"]');
    await expect(input).toBeVisible({ timeout: 20_000 });

    // До ввода делить не на что, и СПВ честно отсутствует: ноль читался
    // бы как «бесплатно».
    await expect(page.locator('[data-test="project-cpv"]')).toHaveCount(0);

    await input.fill('50000');
    await page.locator('[data-test="project-cost-save"]').click();

    const cpv = page.locator('[data-test="project-cpv"]');
    await expect(cpv).toBeVisible({ timeout: 15_000 });
    // Сумма пережила перезагрузку — значит её принял сервер, а не только
    // экран: оптимистичный отклик выглядит точно так же.
    await page.reload();
    await expect(page.locator('[data-test="project-cost"]')).toHaveValue('50000', {
      timeout: 20_000,
    });
    await expect(page.locator('[data-test="project-cpv"]')).toBeVisible();
  });
});

test.describe('заказчик', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'client'));

  test('видит карточку проекта с роликом, а не воронку со стадиями', async ({ page }) => {
    await page.goto(`/me/projects/${brandId}`);

    // Именно карточка «Сотки»: у проекта по воронке на её месте стадии,
    // и до появления четвёртой ветки оба вида решались одним литералом.
    await expect(page.locator('app-client-turnkey-project')).toBeVisible({ timeout: 20_000 });

    await openClientTab(page, 'Ролики');
    // Ролик есть, а подписи «чей» у него нет: он принадлежит проекту.
    await expect(page.getByText('Креатор', { exact: false })).toHaveCount(0);
  });

  test('в деньгах нет ни команды периода, ни прикидки месяца по числу людей', async ({ page }) => {
    await page.goto(`/me/projects/${brandId}`);
    await expect(page.locator('app-client-turnkey-project')).toBeVisible({ timeout: 20_000 });

    await openClientTab(page, 'Деньги');

    // Счёт за период остаётся: платить всё равно есть за что.
    await expect(page.getByRole('heading', { name: /К оплате/ })).toBeVisible();

    // А вот это уходит вместе с креаторами: прикидка считается по числу
    // людей в команде, которых у такого проекта не бывает, и «Заказать
    // этот месяц» звало бы менеджера собирать несуществующий состав.
    await expect(
      page.getByRole('heading', { name: 'Сколько будет стоить следующий месяц' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Заказать этот месяц' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Команда периода' })).toHaveCount(0);
  });
});
