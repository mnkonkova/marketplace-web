import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';
import { STATS } from '../fixtures/world';

/**
 * Заказчик раскрывает ролик по площадкам.
 *
 * Ролик один и тот же — разница только в площадке, и ради этой разницы
 * заказчик страницу и открывает. Данные для неё уже загружены отчётом:
 * до этого страница показывала пять бейджей без ссылок и без цифр.
 *
 * Здесь же — бейдж «N из 5 площадок». Он был зелёным всегда, и ролик,
 * вышедший на двух площадках из пяти, выглядел закрытым. Это не
 * косметика: именно такие ролики менеджер потом и дожимает.
 */
const grouped = (n: number) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s?'));

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.client] as const,
  );
  await page.goto(`/me/projects/${world().projectId}`);
});

test('раскрытый ролик показывает ссылку, просмотры и ER по каждой площадке', async ({ page }) => {
  const open = page.getByRole('button', { name: 'По площадкам' }).first();
  await expect(open, 'у вышедшего ролика есть что раскрыть').toBeVisible({ timeout: 15_000 });
  await open.click();

  const rows = page.locator('.det .prow');
  await expect(rows).toHaveCount(5);

  // Цифры площадок — те же, что собраны: сумма по ролику из них и
  // складывается, и расхождение здесь означает, что заказчик и менеджер
  // смотрят на разные числа.
  const tiktok = rows.filter({ hasText: 'TikTok' });
  await expect(tiktok.locator('.pv')).toContainText(grouped(STATS.today.tiktok));
  await expect(tiktok.locator('.pu')).toHaveAttribute('href', /tiktok\.com/);
  await expect(tiktok.locator('.er')).toContainText('ER');

  // И сворачивается обратно.
  await page.getByRole('button', { name: 'Свернуть' }).first().click();
  await expect(rows).toHaveCount(0);
});

test('полностью вышедший ролик помечен зелёным', async ({ page }) => {
  const badge = page.locator('.tag').filter({ hasText: 'из 5 площадок' }).first();
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toContainText('5 из 5');
  // Зелёный — только когда вышли все пять. Класс проверяем прямо: он и
  // есть то самое обещание «ролик закрыт».
  await expect(badge).toHaveClass(/green/);
  await expect(badge).not.toHaveClass(/amber/);
});
