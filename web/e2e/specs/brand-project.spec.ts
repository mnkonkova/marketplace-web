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

  /**
   * Даты. Главная поломка вида: проставить их было НЕЧЕМ.
   *
   * План выкладок строится сеткой «креатор × день», и пустой состав он
   * закрывал надписью «сначала соберите состав» — правильной у проекта
   * с креаторами и тупиковой здесь, где состава не будет никогда. Окно
   * «Проставить пачкой» спрашивало «Кому», считало «люди × дни» (ноль
   * при нуле людей, кнопка выключена) и на отправке отвечало «Выберите
   * хотя бы одного креатора». При этом сервер такие пачки принимал с
   * самого начала: у выкладки такого проекта владельца нет вовсе.
   */
  test('ставит даты пачкой, не выбирая креаторов', async ({ page }) => {
    await page.goto(`/manager/projects/${brandId}`);
    const plan = page.locator('.sec-plan');
    await expect(plan).toBeVisible({ timeout: 20_000 });

    // Не «соберите состав»: собирать его здесь не из кого и не будут.
    await expect(plan, 'тупиковая надпись про состав ушла').not.toContainText(
      'сначала соберите состав',
    );
    // Вместо строки человека — строка проекта: ролик принадлежит
    // проекту, и сетка остаётся сеткой.
    await expect(plan).toContainText('Ролики проекта');

    await plan.getByRole('button', { name: 'Проставить пачкой' }).click();
    const dialog = page.locator('.ant-modal-content');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Вопроса «Кому» нет вовсе, а не пустой список под ним: пустой
    // список читается как «состав ещё не подъехал».
    await expect(dialog, 'выбирать некого — и не спрашиваем').not.toContainText('Кому');
    await expect(dialog).toContainText('Ролики выходят с аккаунтов бренда');
    // Черновик сдаёт креатор, а принимает менеджер: здесь его некому
    // сдавать, и второй срок был бы датой, к которой никто не должен.
    await expect(dialog).not.toContainText('Этап согласования черновика');

    // Отмечаем свободный день следующего месяца: текущий может быть
    // почти прожит, а прошедшие дни в календаре выключены.
    await dialog.getByRole('button', { name: 'Вперёд' }).click();
    const day = dialog.locator('.dc:not(.pad):not(.past):not(.set)').nth(9);
    await day.click();

    // Счётчик считает ДАТЫ, а не «люди × дни»: людей ноль, старая
    // формула давала ноль, и кнопка оставалась выключенной. Смотрим
    // само число, а не строку целиком: «0 новых · 1 уже в плане» тоже
    // содержит единицу.
    await expect(dialog.locator('.summarybar b'), 'добавится одна выкладка').toHaveText('1');

    await dialog.getByRole('button', { name: /Создать выкладки|Добавить даты/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Дата доехала до сервера, а не только до экрана: перезагружаем и
    // ищем её в плане.
    await page.reload();
    await expect(page.locator('.sec-plan')).toBeVisible({ timeout: 20_000 });
    const planned = await callAs(
      box.manager,
      'get',
      `/api/v1/manager/projects/${brandId}/publications`,
    );
    const rows = (planned.items ?? []) as { creator_user_id?: string; status: string }[];
    expect(rows.length, 'выкладок стало больше').toBeGreaterThan(1);
    expect(
      rows.every((p) => !p.creator_user_id),
      'владельца у выкладок такого проекта нет',
    ).toBe(true);
  });

  /**
   * Одна дата, а не пачка. Живой месяц правится по одной клетке:
   * перенесли съёмку, добавили ролик. Ручка `POST .../publications`
   * отказывала на пустом creator_user_id ещё до чтения вида проекта —
   * «Нужны creator_user_id и due_date», 400, — хотя репозиторий за ней
   * умел вставлять выкладку без владельца с самого начала.
   */
  test('ставит одну дату прямо в сетке плана', async ({ page }) => {
    await page.goto(`/manager/projects/${brandId}`);
    const plan = page.locator('.sec-plan');
    await expect(plan).toBeVisible({ timeout: 20_000 });

    // Следующий месяц: в текущем свободных дней впереди может не
    // остаться вовсе, а выкладку задним числом сервер не заводит.
    await plan.getByRole('button', { name: 'Следующий месяц' }).click();
    // Первая ячейка строки — название, дальше дни по порядку.
    await plan.locator('.grid-plan tbody tr td').nth(20).locator('button.c').click();

    const before = await callAs(
      box.manager,
      'get',
      `/api/v1/manager/projects/${brandId}/publications`,
    );
    // Строка правки под сеткой, а не клетка: подпись у клетки та же
    // самая («свободно, поставить выкладку»), и по имени они неотличимы.
    const edit = plan.locator('.edit');
    await expect(edit, 'строка правки открылась').toBeVisible();
    await edit.getByRole('button', { name: 'Поставить выкладку' }).click();

    // Ждём сервер, а не всплывашку: она живёт три секунды и ловится
    // гонкой.
    await expect
      .poll(
        async () => {
          const now = await callAs(
            box.manager,
            'get',
            `/api/v1/manager/projects/${brandId}/publications`,
          );
          return ((now.items ?? []) as unknown[]).length;
        },
        { message: 'выкладка завелась', timeout: 15_000 },
      )
      .toBeGreaterThan(((before.items ?? []) as unknown[]).length);
  });

  /**
   * Ссылки. Блок группирует ролики по людям и при пустом составе
   * говорил «Состав пуст — ссылок пока неоткуда взяться». Ролики при
   * этом выходят, и адрес им ставит менеджер руками: группа здесь
   * одна — сам проект.
   */
  test('ставит ссылку на ролик проекта', async ({ page }) => {
    await page.goto(`/manager/projects/${brandId}`);
    const links = page.locator('.sec-links');
    await expect(links).toBeVisible({ timeout: 20_000 });

    await expect(links, 'тупиковая надпись про состав ушла').not.toContainText('Состав пуст');
    await expect(links).toContainText('Ролики проекта');
    // Площадки ролика на месте — значит по ним и правят адрес.
    await expect(links.locator('.pl-plats').first()).toBeVisible();
  });

  /**
   * Автопинги. Четыре тумблера из пяти обещали письмо КРЕАТОРУ — а бэк
   * такие напоминания у проекта без состава не отправляет вовсе: ни в
   * личку (некому), ни в чат (шестьдесят «просрочка» за одно утро по
   * одному проекту). Их единственный след — дневная сводка менеджерам,
   * и она здесь единственный тумблер, который на что-то влияет.
   */
  test('в автопингах остаётся только сводка менеджерам', async ({ page }) => {
    await page.goto(`/manager/projects/${brandId}`);
    const ping = page.locator('.ping-block');
    await expect(ping).toBeVisible({ timeout: 20_000 });

    await expect(ping.locator('.switchrow')).toHaveCount(1);
    await expect(ping).toContainText('Сводка в чат менеджеров');
    // Не «выключены», а отсутствуют: выключенный тумблер обещает, что
    // его можно включить.
    await expect(ping, 'обещаний написать креатору не осталось').not.toContainText(
      'Креатору в бот',
    );
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

/**
 * Стоимость проекта, у которого ещё не вышло ни одного ролика.
 *
 * Свой проект, а не общий: у того ролики вышли, периоды есть, и
 * денежная ручка отвечает нормально — то есть ровно то состояние, в
 * котором поломки не было.
 *
 * А была она такая. Условия проекта карточка читает из GET /billing, и
 * эта ручка у проекта без периодов отвечает 404 no_periods — теряя
 * вместе с несуществующим периодом условия, которые от периода не
 * зависят вовсе. Поле «Сколько стоит проект» стояло пустым при
 * записанной сумме; человек читал это как «не сохранилось» и жал
 * «Сохранить» поверх пустого — уходил ноль, сумма стиралась молча, с
 * зелёной плашкой «Стоимость проекта сохранена», а СПВ не появлялся
 * никогда.
 */
test.describe('менеджер: стоимость до первого ролика', () => {
  let freshId = '';

  test.beforeAll(async () => {
    const project = await callAs(box.manager, 'post', '/api/v1/manager/projects', {
      kind: 'brand_turnkey',
      title: `Бренд без роликов ${box.tag} (e2e-sandbox)`,
      client_user_id: box.client.userId,
      is_test: true,
    });
    freshId = project.id as string;
    // Сумму называет менеджер — она есть до любых роликов.
    await callAs(box.manager, 'put', `/api/v1/manager/projects/${freshId}/billing`, {
      project_cost: 100000 * 100,
      salary_per_month: 0,
      rate_per_1000_views: 0,
      rate_per_1000_views_over: 0,
      bonus_views_threshold: 0,
    });
  });

  test.afterAll(() => {
    if (freshId) dropProject(freshId);
  });

  test.beforeEach(async ({ page }) => signIn(page, 'manager'));

  test('записанная сумма видна в поле, и пустое «Сохранить» её не стирает', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/billing')) sent.push(r.postData() ?? '');
    });

    await page.goto(`/manager/projects/${freshId}`);
    const input = page.locator('[data-test="project-cost"]');
    await expect(input).toBeVisible({ timeout: 20_000 });
    await expect(input, 'сумма на месте, хотя периодов ещё нет').toHaveValue('100000');

    // СПВ здесь честно нет: делить не на что, и экран это объясняет.
    await expect(page.locator('[data-test="project-cpv"]')).toHaveCount(0);
    await expect(
      page.getByText('СПВ появится, когда будут и стоимость, и просмотры'),
    ).toBeVisible();

    // Человек стёр поле и нажал «Сохранить» — ноль улететь не должен.
    await input.fill('');
    await page.locator('[data-test="project-cost-save"]').click();
    await page.waitForTimeout(1200);
    for (const body of sent) {
      expect(body, 'ноль стёр бы записанную стоимость').not.toContain('"project_cost":0');
    }

    // И запись пережила нажатие: перечитываем страницу, а не сигнал.
    await page.reload();
    await expect(page.locator('[data-test="project-cost"]')).toHaveValue('100000', {
      timeout: 20_000,
    });
  });
});

test.describe('заказчик', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'client'));

  test('видит карточку проекта с роликом, а не воронку со стадиями', async ({ page }) => {
    await page.goto(`/me/projects/${brandId}`);

    // Именно карточка «PrMarket»: у проекта по воронке на её месте стадии,
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
