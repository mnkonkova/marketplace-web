import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, STATS } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openCreatorTab, openManagerTab } from '../fixtures/ui';

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

  test('плитки, график и разбивка по площадкам показывают собранные цифры', async ({ page }) => {
    await page.goto(`/manager/projects/${box.projectId}`);
    // Статистика у «креаторов под ключ» — отдельная вкладка.
    await openManagerTab(page, 'Статистика');

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
    await page.goto(`/manager/projects/${box.projectId}`);

    // Сравнение креаторов живёт в разделе «Команда» карточки: строка на
    // человека — сколько сдал, сколько набрал. Идентификатору здесь
    // взяться неоткуда, и это ровно то, что проверяется: менеджер
    // сверяет людей, а не строки базы.
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

    // Ищем внутри строки посеянной выкладки, а не по всей странице: в
    // проекте могут стоять и другие ролики, и у каждого свои площадки —
    // без привязки к строке локатор находит их все. Вышедшие выкладки
    // живут списком, отдельной карточки у них больше нет.
    const card = page.locator('.posts2 .row').filter({ hasText: box.publicationTitle });
    await expect(card).toHaveCount(1);

    // Цифры площадок стоят рядом с их кодами, прямо в строке ролика:
    // «где зашло» — вопрос, ради которого креатор сюда и смотрит, и
    // прятать на него ответ под кнопку значит не отвечать.
    //
    // Проверяем по значку площадки, а не по тексту всей строки: рядом
    // стоит общий итог ролика, и в склеенном тексте цифры слипаются —
    // поиск подстрокой начинает врать.
    const rows: Record<string, string> = {
      TT: String(STATS.today.tiktok),
      IG: String(STATS.today.instagram),
      YT: String(STATS.today.youtube),
      VK: String(STATS.today.vk),
      LK: String(STATS.today.likee),
    };
    for (const [short, views] of Object.entries(rows)) {
      const chip = card.locator('.plat').filter({ hasText: short });
      await expect(chip.locator('.v'), short).toHaveText(grouped(Number(views)));
    }

    // И общий итог по ролику — в той же строке.
    await expect(card.locator('.views-cell')).toContainText(grouped(STATS.totalToday));
  });
});
