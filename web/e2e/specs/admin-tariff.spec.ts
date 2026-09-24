import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Прайс площадки в админке.
 *
 * Проверяем две вещи, которые ломаются молча. Первая — форма открывается
 * копией действующей версии: прайс правят одной ставкой, и пустая форма
 * заставила бы набирать тринадцать полей заново, а промах в одном из них
 * ушёл бы в новую версию. Вторая — защита от доли креатора больше цены
 * клиента: это не тариф, а убыток на каждом ролике, и почти всегда просто
 * опечатка.
 *
 * Выпуск новой версии намеренно не проверяем: он необратим (старые версии
 * не удаляются), и каждый прогон плодил бы версию в общей для остальных
 * специй базе.
 */
test.beforeEach(async ({ context, page }) => {
  const w = world();
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, w.sessions.admin] as const,
  );
  await page.goto('/admin/tariff');
  // Страница открывается РЕЕСТРОМ ПРОЕКТОВ: прайс площадки стал
  // шаблоном, с которого заполняют новый проект, и лежит он соседним
  // видом. Специи здесь про шаблон — переключаемся на него.
  await page.getByRole('button', { name: 'Шаблон площадки' }).click();
});

test('разделы админки ведут по страницам, канбана среди них нет', async ({ page }) => {
  const nav = page.locator('.crm-shell .side');
  await expect(nav.getByRole('link', { name: 'Продакшены' })).toBeVisible({ timeout: 15_000 });
  // Канбан — вид раздела «Проекты», а не соседний раздел: пункт в меню он
  // занимал наравне с ними, хотя отвечает на тот же вопрос.
  await expect(nav.getByRole('link', { name: 'Канбан' })).toHaveCount(0);

  await nav.getByRole('link', { name: 'Воронки' }).click();
  await expect(page).toHaveURL(/\/admin\/pipelines$/);
});

/**
 * Поле «За 1000 просмотров» по счёту: 0 — заказчик, 1 — креатор.
 *
 * По подписи, а не по номеру среди всех number-полей: форма прайса
 * растёт (фикс за ролик, KPI по подписчикам), и номера в ней смещаются
 * от каждой такой правки.
 */
function rateField(dialog: ReturnType<Page['getByRole']>, n: number) {
  return dialog.locator('label').filter({ hasText: 'За 1000 просмотров' }).nth(n).locator('input');
}

test('форма новой версии открывается копией действующей', async ({ page }) => {
  // Действующая версия видна карточками ставок.
  await expect(page.locator('.rate').first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Выпустить версию прайса' }).click();

  const dialog = page.getByRole('dialog', { name: 'Новая версия прайса' });
  await expect(dialog).toBeVisible();

  // Ставка подставлена из прайса, а не оставлена нулём.
  //
  // Поле ищем по подписи, а не по номеру: номера сдвигаются от любой
  // новой строки в форме, и специя падала бы на правке, к которой она
  // отношения не имеет.
  await expect(rateField(dialog, 0)).not.toHaveValue('0');
  await expect(dialog.locator('textarea')).not.toHaveValue('');
});

test('доля креатора больше цены клиента не выпускается', async ({ page }) => {
  await page.getByRole('button', { name: 'Выпустить версию прайса' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая версия прайса' });

  // Ставка креатора за 1000 просмотров — заведомо выше клиентской.
  // Первое такое поле — клиентское, второе — креаторское: подпись у них
  // одна, а секции разные.
  await rateField(dialog, 0).fill('90');
  await rateField(dialog, 1).fill('900');

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/admin/terms') && r.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Выпустить версию' }).click(),
  ]);
  expect(response.status(), 'бэк обязан отказать').toBe(400);

  // Окно остаётся открытым: иначе правку негде было бы поправить.
  await expect(dialog).toBeVisible();
});
