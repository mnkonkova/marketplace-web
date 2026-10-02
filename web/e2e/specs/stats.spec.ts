import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, STATS } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openCreatorTab } from '../fixtures/ui';

/**
 * Отрисовка статистики.
 *
 * Числа приходят с сервера правильными — это уже проверено сквозными
 * тестами API. Здесь проверяется другое: доехали ли они до экрана и в
 * каком виде. Сломаться тут можно тихо и дорого — потеряться в разбивке
 * по площадкам, съехать на порядок, показаться нулём вместо «нет данных».
 *
 * Пробелы в числах разделительные и неразрывные, поэтому сравниваем по
 * шаблону, а не строкой: \s в JS покрывает и обычный пробел, и U+00A0.
 */

/**
 * 3 000 000 с любым пробелом между группами.
 *
 * Границы по цифрам обязательны: без них «50 000» находится внутри
 * «150 000», и проверка площадок молча проходит на чужой строке.
 */
const grouped = (n: number): RegExp =>
  new RegExp('(?<!\\d)' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s?') + '(?!\\d)');

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
  box = await createSandbox('statsbox');
});

test.afterAll(() => dropSandbox(box));

function signIn(page: Page, role: 'manager' | 'client' | 'creator') {
  return page
    .context()
    .addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions[role]] as const,
    );
}

test.describe('менеджер', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'manager'));

  test('«Ролики»: площадки и итог показывают собранные цифры', async ({ page }) => {
    await page.goto(`/manager/projects/${box.projectId}`);
    // Отдельного блока «Статистика» у менеджера больше нет: какая
    // площадка тянет и каждый ролик по площадкам — вкладка «Ролики».
    await page.locator('.secnav button', { hasText: 'Ролики' }).click();
    const vm = page.locator('app-video-matrix');
    await expect(vm).toBeVisible({ timeout: 15_000 });

    // Сводка: пять площадок, у каждой своя цифра. Именно здесь ломается
    // тихо — доля площадки легко считается от неправильного знаменателя.
    const rows = vm.locator('.vm-sum-row:not(.vm-sum-head)');
    await expect(rows).toHaveCount(5);
    // Ищем по ячейке просмотров, а не по тексту строки: в склеенном
    // тексте за числом сразу идёт доля, и цифры слипаются.
    for (const [platform, views] of Object.entries(STATS.today)) {
      await expect(rows.locator('b.num').filter({ hasText: grouped(views) }), platform).toHaveCount(1);
    }
    const share = ((STATS.today.tiktok / STATS.totalToday) * 100).toFixed(1).replace('.', ',');
    await expect(rows.first(), 'доля TikTok от общего числа').toContainText(`${share}%`);

    // Итог за сегодня и прирост относительно вчера — в нижней строке.
    const grand = vm.locator('tfoot .cell.grand');
    await expect(grand).toContainText(grouped(STATS.totalToday));
    await vm.getByRole('button', { name: 'За сутки' }).click();
    await expect(grand).toContainText(grouped(STATS.growth));
  });

  test('в сравнении креаторов имя, а не uuid', async ({ page }) => {
    await page.goto(`/manager/projects/${box.projectId}`);

    // Сравнение креаторов живёт в разделе «Команда» карточки: строка на
    // человека — сколько сдал, сколько набрал. Идентификатору здесь
    // взяться неоткуда, и это ровно то, что проверяется: менеджер
    // сверяет людей, а не строки базы.
    await page.locator('.secnav button', { hasText: 'Команда' }).click();
    const table = page.locator('.sec-team');
    await expect(table.getByText(box.creator.name).first()).toBeVisible({ timeout: 15_000 });
    await expect(table, 'в таблицах имя, а не идентификатор').not.toContainText(
      box.projectId.slice(0, 8),
    );
  });
});

test.describe('заказчик', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'client'));

  test('видит те же цифры, что менеджер, и вышедший ролик в ленте', async ({ page }) => {
    await page.goto(`/me/projects/${box.projectId}`);

    // Итог стоит первым числом карточки: экран отвечает заказчику на
    // «сколько людей это посмотрели» раньше, чем на всё остальное.
    // Подпись за год менялась трижды («Просмотры, всего», «Ролики
    // посмотрели», «Просмотры за период»), и привязываться к ней значит
    // переписывать спеку на каждую редактуру. Проверяем обещание:
    // главное число карточки — просмотры, и они те же, что у менеджера.
    // Лента просмотров стоит над всем экраном — это и есть главное
    // число карточки.
    const hero = page.locator('.ribbon');
    await expect(hero, 'заказчик и менеджер смотрят на один отчёт').toBeVisible({
      timeout: 15_000,
    });
    await expect(hero.locator('.big')).toHaveText(grouped(STATS.totalToday));

    // Лента: ролик, его автор и просмотры по ролику целиком.
    const body = page.locator('body');
    await expect(body).toContainText(box.creator.name);
    await expect(body).toContainText(grouped(STATS.totalToday));
  });
});

test.describe('креатор', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'creator'));

  test('видит свои цифры по каждой площадке', async ({ page }) => {
    await page.goto(`/me/creator/projects/${box.projectId}`);

    await openCreatorTab(page, 'Мои выкладки');

    // Вышедшие ролики — таблицей «ролик × площадка», как «Ролики» у
    // менеджера, только по своим роликам.
    const row = page
      .locator('app-creator-videos table.cv tbody tr')
      .filter({ hasText: box.publicationTitle });
    await expect(row).toHaveCount(1);

    // Колонки — в порядке площадок проекта; в клетке — просмотры этой
    // площадки. «Где зашло» — вопрос, ради которого креатор сюда и
    // смотрит.
    const cells = row.locator('td .cell:not(.total)');
    await expect(cells).toHaveCount(5);
    const views = Object.values(STATS.today);
    for (let i = 0; i < views.length; i += 1) {
      await expect(cells.nth(i).locator('b')).toHaveText(grouped(views[i]));
    }

    // И общий итог по ролику — в последней клетке строки.
    await expect(row.locator('.cell.total')).toContainText(grouped(STATS.totalToday));
  });
});
