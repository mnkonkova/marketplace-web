import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, STATS, world } from '../fixtures/world';

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

function signIn(page: Page, role: 'manager' | 'client' | 'creator') {
  return page
    .context()
    .addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, world().sessions[role]] as const,
    );
}

test.describe('менеджер', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'manager'));

  test('плитки, график и разбивка по площадкам показывают собранные цифры', async ({ page }) => {
    const w = world();
    await page.goto(`/manager/projects/${w.projectId}`);
    // Статистика у «креаторов под ключ» — отдельная вкладка.
    await page.getByRole('button', { name: /^Статистика/ }).click();

    const stats = page.locator('app-project-stats');
    await expect(stats).toBeVisible({ timeout: 15_000 });

    // Итог за сегодня и прирост относительно вчера.
    await expect(stats).toContainText(grouped(STATS.totalToday));
    await expect(stats).toContainText(grouped(STATS.growth));

    // Пустого состояния быть не должно: цифры есть.
    await expect(stats).not.toContainText('Цифр пока нет');

    // График рисуется по двум дням — линия с двумя точками.
    const polyline = stats.locator('svg[aria-label="Просмотры нарастающим итогом"] polyline');
    await expect(polyline).toHaveCount(1);
    const points = (await polyline.getAttribute('points')) ?? '';
    expect(points.trim().split(/\s+/).length, 'точек на графике по числу дней').toBeGreaterThan(1);

    // Разбивка: пять площадок, у каждой своя цифра. Именно здесь ломается
    // тихо — доля площадки легко считается от неправильного знаменателя.
    const rows = stats.locator('.byplat li');
    await expect(rows).toHaveCount(5);
    for (const [platform, views] of Object.entries(STATS.today)) {
      await expect(rows.filter({ hasText: grouped(views) }), platform).toHaveCount(1);
    }

    // Доля TikTok — две трети от трёх миллионов. Проверяем ширину полосы:
    // это единственное место, где видно, от чего считали процент.
    const tiktokBar = rows.first().locator('.bar i');
    const width = await tiktokBar.evaluate((el) => (el as HTMLElement).style.width);
    expect(Math.round(parseFloat(width)), 'доля TikTok от общего числа').toBe(
      Math.round((STATS.today.tiktok / STATS.totalToday) * 100),
    );
  });

  test('в сравнении креаторов имя, а не uuid', async ({ page }) => {
    const w = world();
    await page.goto(`/manager/projects/${w.projectId}`);

    // Сравнение креаторов живёт в виджете выкладок, а не в блоке
    // статистики: там же, где таблица роликов.
    const table = page.locator('app-project-publications');
    await expect(table.getByText('Анастасия Креатор').first()).toBeVisible({ timeout: 15_000 });
    await expect(table, 'в таблицах имя, а не идентификатор').not.toContainText(
      w.projectId.slice(0, 8),
    );
  });
});

test.describe('заказчик', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'client'));

  test('видит те же цифры, что менеджер, и вышедший ролик в ленте', async ({ page }) => {
    const w = world();
    await page.goto(`/me/projects/${w.projectId}`);

    // Итоги у заказчика стоят плитками наверху страницы, а не внутри
    // блока статистики: в блоке остался только график по дням.
    const tile = page.locator('.kpi').filter({ hasText: 'Просмотры, всего' });
    await expect(tile, 'заказчик и менеджер смотрят на один отчёт').toBeVisible({
      timeout: 15_000,
    });
    await expect(tile.locator('.v')).toHaveText(grouped(STATS.totalToday));

    // Лента: ролик, его автор и просмотры по ролику целиком.
    const body = page.locator('body');
    await expect(body).toContainText('Анастасия Креатор');
    await expect(body).toContainText(grouped(STATS.totalToday));
  });
});

test.describe('креатор', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'creator'));

  test('видит свои цифры по каждой площадке', async ({ page }) => {
    const w = world();
    await page.goto(`/me/creator/projects/${w.projectId}`);

    const body = page.locator('body');
    await expect(body.getByText('Мои выкладки').first()).toBeVisible({ timeout: 15_000 });

    // Ищем внутри карточки посеянной выкладки, а не по всей странице: в
    // проекте могут стоять и другие ролики, и у каждого свои пять строк
    // площадок — без привязки к карточке локатор находит их все.
    const card = page.locator('.slotcard').filter({ hasText: 'Выкладка 01' });
    await expect(card).toHaveCount(1);

    // Цифры по площадкам спрятаны под «Показать ссылки» — так в макете:
    // в списке видно состояние выкладки, а разбор по площадкам
    // открывается по требованию.
    await card.getByRole('button', { name: 'Показать ссылки' }).click();

    // Проверяем по строке площадки, а не по тексту всей страницы: рядом
    // с числом стоит ссылка, и в склеенном тексте её цифры прилипают к
    // просмотрам — поиск подстрокой начинает врать.
    const rows: Record<string, string> = {
      TikTok: String(STATS.today.tiktok),
      Reels: String(STATS.today.instagram),
      Shorts: String(STATS.today.youtube),
      'VK Клипы': String(STATS.today.vk),
      Likee: String(STATS.today.likee),
    };
    for (const [name, views] of Object.entries(rows)) {
      const row = card.locator('.p2').filter({ hasText: name });
      await expect(row.locator('.v'), name).toHaveText(grouped(Number(views)));
    }

    // И общий итог по ролику — в той же раскрытой карточке.
    await expect(card.locator('.totalrow')).toContainText(grouped(STATS.totalToday));
  });
});
