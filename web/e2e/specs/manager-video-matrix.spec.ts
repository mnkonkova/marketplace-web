import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, STATS, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/**
 * Менеджер видит каждый ролик на каждой площадке.
 *
 * До этой таблицы «Статистика» отвечала про каналы в целом и про людей,
 * а цифры ролика по площадкам лежали в свёрнутом списке ссылок; на
 * телефоне их не было вовсе. Здесь проверяется то, ради чего таблицу
 * завели: число в клетке «ролик × площадка», прирост за сутки по
 * переключателю, отказ сборщика словами — и то же самое карточкой на
 * телефоне.
 *
 * Песочница своя: отказ сборщика портит ссылку, и соседям это ни к чему.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('vmatrix');
});

test.afterAll(() => dropSandbox(box));

const grouped = (n: number) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s?'));

async function open(page: Page): Promise<void> {
  await page
    .context()
    .addInitScript(([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)), [
      AUTH_KEY,
      box.sessions.manager,
    ] as const);
  await page.goto(`/manager/projects/${box.projectId}`);
  // На десктопе разделы — вкладками, и открыт первый, «Горит».
  await openManagerTab(page, 'Ролики');
}

test('таблица показывает ролик по каждой площадке и прирост за сутки', async ({ page }) => {
  await open(page);
  const table = page.locator('app-video-matrix table.vm');
  await expect(table, 'таблица роликов стоит на странице').toBeVisible({ timeout: 20_000 });

  const row = table.locator('tbody tr').first();
  const cells = row.locator('td');
  // Колонки — в порядке площадок: TikTok, Reels, Shorts, VK, Likee, Всего.
  await expect(cells.nth(0)).toContainText(grouped(STATS.today.tiktok));
  await expect(cells.nth(1)).toContainText(grouped(STATS.today.instagram));
  await expect(cells.nth(4)).toContainText(grouped(STATS.today.likee));
  await expect(cells.nth(5), 'итог ролика — сумма площадок').toContainText(
    grouped(STATS.totalToday),
  );

  // Клетка — ссылка на сам ролик на площадке.
  await expect(cells.nth(0).locator('a')).toHaveAttribute('href', /tiktok/);

  await page.locator('app-video-matrix').getByRole('button', { name: 'За сутки' }).click();
  await expect(cells.nth(0)).toContainText(
    '+' + String(STATS.today.tiktok - STATS.yesterday.tiktok).replace(/\B(?=(\d{3})+(?!\d))/g, ' '),
  );
});

test('отказ сборщика подписан словами, а не нулём', async ({ page }) => {
  // VK: снимков нет, сборщик ответил отказом — как на проде 1 октября.
  psql(`
DELETE FROM video_stat_daily WHERE link_id IN (
  SELECT l.id FROM publication_links l JOIN project_publications p ON p.id = l.publication_id
  WHERE p.project_id = '${box.projectId}' AND l.platform = 'vk');
UPDATE publication_links l SET last_collected_at = NULL,
  last_collect_error = 'Метрики отдельных постов для ''vk'' пока не поддержаны',
  last_collect_try_at = now()
FROM project_publications p
WHERE p.id = l.publication_id AND p.project_id = '${box.projectId}' AND l.platform = 'vk';
`);
  await open(page);
  const vk = page.locator('app-video-matrix table.vm tbody tr').first().locator('td').nth(3);
  await expect(vk).toContainText('площадка не собирается', { timeout: 20_000 });
  await expect(vk.locator('a'), 'исходный ответ сборщика — в подсказке').toHaveAttribute(
    'title',
    /не поддержаны/,
  );
  // Числа в клетке нет вовсе — ни нуля, ни любого другого.
  //
  // Здесь стояло `not.toContainText(/^\s*0\s*$/)`: анкеры ^$ по всему
  // тексту клетки, в которой уже стоит подпись отказа, — совпасть такой
  // шаблон не мог никогда, и проверка держалась зелёной при любом
  // поведении, включая то, против которого её писали.
  await expect(vk, 'в клетке отказа цифр нет').not.toContainText(/\d/);

  // И в итоге по столбцу — прочерк. Отказ по всем ссылкам площадки
  // складывался в сумму из нулей, и внизу стоял честный на вид ноль:
  // по нему менеджер объяснял заказчику, что площадка не работает,
  // хотя не работал сбор.
  const foot = page.locator('app-video-matrix tfoot tr td').nth(3);
  await expect(foot.locator('b'), 'итог по VK — прочерк, а не ноль').toHaveText('—');
  await expect(foot, 'ссылка при этом посчитана').toContainText('ссылок: 1');

  // А «какая площадка тянет» про неё молчит: с нулём просмотров и долей
  // «0,0%» она сказала бы «тут не смотрят» вместо «тут не собралось».
  await expect(
    page.locator('app-video-matrix .vm-sum .vm-sum-row .pn', { hasText: 'VK' }),
  ).toHaveCount(0);
});

test('на телефоне ролики — вкладка с карточками по площадкам', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const tab = page.locator('app-prmarket-tabbar button', { hasText: 'Ролики' }).first();
  await expect(tab, 'вкладка называется по содержимому').toBeVisible({ timeout: 20_000 });
  await tab.click();

  const card = page.locator('app-video-matrix .vm-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.vm-prow').first()).toContainText(grouped(STATS.today.tiktok));
  await expect(
    page.locator('app-video-matrix table.vm'),
    'таблица на телефоне не рисуется',
  ).toBeHidden();

  const de = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(de.scroll, 'страница не прокручивается вбок').toBeLessThanOrEqual(de.client);
});

/**
 * Креаторов в проекте бывает несколько, и итог нужен и по каждому, и по
 * всем: проект отвечает про деньги заказчика, а человек — про то, звать
 * ли его в следующий месяц. Своя песочница на двоих (форма crew): у
 * первого два ролика по 200 000, у второго один на 3 000 000.
 */
test.describe('несколько креаторов', () => {
  let crew: Sandbox;

  test.beforeAll(async () => {
    crew = await createSandbox('vmcrew', { shape: 'crew', creators: 2 });
  });

  test.afterAll(() => dropSandbox(crew));

  test('итог по каждому креатору, итог по всем и фильтр', async ({ page }) => {
    await page
      .context()
      .addInitScript(([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)), [
        AUTH_KEY,
        crew.sessions.manager,
      ] as const);
    await page.goto(`/manager/projects/${crew.projectId}`);
    await page.locator('.secnav button', { hasText: 'Ролики' }).click();

    const vm = page.locator('app-video-matrix');
    const [a, b] = crew.creators;
    const subA = vm.locator('tr.vm-sub', { hasText: `Итого: ${a.name}` });
    const subB = vm.locator('tr.vm-sub', { hasText: `Итого: ${b.name}` });
    await expect(subA, 'строка итога первого креатора').toBeVisible({ timeout: 20_000 });
    await expect(subA.locator('td').last()).toContainText(grouped(400_000));
    await expect(subB.locator('td').last()).toContainText(grouped(3_000_000));

    const foot = vm.locator('tfoot tr');
    await expect(foot).toContainText('Итого по всем');
    await expect(foot.locator('td').last()).toContainText(grouped(3_400_000));

    // Фильтр: только второй — его итог внизу, групп нет.
    await vm.locator('.vm-who').getByRole('button', { name: b.name }).click();
    await expect(foot).toContainText(`Итого: ${b.name}`);
    await expect(foot.locator('td').last()).toContainText(grouped(3_000_000));
    await expect(vm.locator('tr.vm-sub')).toHaveCount(0);
  });
});

/**
 * Вкладки на десктопе: виден один раздел. И старых блоков больше нет —
 * «Статистика» и «Ссылки на ролики» стали вкладкой «Ролики».
 */
test('на десктопе разделы — вкладками, старых «Статистики» и «Ссылок» нет', async ({ page }) => {
  await open(page);
  const nav = page.locator('.secnav');
  await expect(nav).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.sec-plan')).toBeHidden();

  await nav.getByRole('button', { name: 'План' }).click();
  await expect(page.locator('.sec-plan')).toBeVisible();
  await expect(page.locator('app-video-matrix')).toBeHidden();

  await nav.getByRole('button', { name: /Ролики/ }).click();
  await expect(page.locator('app-video-matrix')).toBeVisible();
  await expect(page.locator('.sec-plan')).toBeHidden();

  await expect(page.locator('app-project-stats')).toHaveCount(0);
  await expect(page.locator('app-project-links')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ссылки на ролики' })).toHaveCount(0);
});

test('ссылку ролика правят прямо в таблице', async ({ page }) => {
  await open(page);
  await page.locator('.secnav button', { hasText: 'Ролики' }).click();
  const vm = page.locator('app-video-matrix');
  await vm.locator('.vm-links-btn').first().click();
  const editor = vm.locator('.vm-links').first();
  await expect(editor.locator('.vm-link')).toHaveCount(5);
  await editor.locator('.vm-link').first().getByRole('button', { name: 'Заменить' }).click();
  await expect(editor.locator('input[type="url"]')).toBeVisible();
});

/**
 * «Напомнить» — у ролика, где не хватает ссылок. Раньше кнопка жила в
 * списке ссылок и в плане; таблица заменила список, и напомнить из неё
 * было нечем. Последней в файле: тест снимает ссылку с ролика.
 */
test('у ролика без ссылки есть «Напомнить»', async ({ page }) => {
  psql(`
DELETE FROM video_stat_daily WHERE link_id IN (
  SELECT l.id FROM publication_links l JOIN project_publications p ON p.id = l.publication_id
  WHERE p.project_id = '${box.projectId}' AND l.platform = 'likee');
DELETE FROM publication_links l USING project_publications p
WHERE p.id = l.publication_id AND p.project_id = '${box.projectId}' AND l.platform = 'likee';
`);
  await open(page);
  const vm = page.locator('app-video-matrix');
  const remind = vm.locator('table.vm').getByRole('button', { name: 'Напомнить' }).first();
  await expect(remind).toBeVisible({ timeout: 20_000 });
  await remind.click();
  await expect(page.locator('.ant-message')).toContainText(/Напомнили|уже напоминали/);
});
