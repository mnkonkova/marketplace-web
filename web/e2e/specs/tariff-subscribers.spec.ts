import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Доплата за подписчиков: «за одного» или ступенями.
 *
 * Поштучная цена на росте в сотню тысяч даёт сумму, которую никто не
 * закладывал, — отсюда вторая форма. Формы взаимоисключающие, и это не
 * оформление: сервер отвечает отказом, если присланы обе, потому что
 * «ступени плюс по рублю за остаток» — третье правило счёта, которого
 * никто не называл.
 *
 * Здесь проверяется живой круг, которого юнит-специи не видят: выбрал
 * ступени → заполнил → сохранил → вернулся и увидел ИХ, а не прежнюю
 * ставку. Юниты проверяют, что уедет на сервер; только этот круг
 * проверяет, что сервер это принял и отдал назад.
 */
let box: Sandbox;

test.beforeAll(async () => {
  // isTest: false — реестр тарифов намеренно не показывает тестовые
  // проекты, а тариф проекта правят только из него.
  box = await createSandbox('subs', { isTest: false });
});

test.afterAll(() => dropSandbox(box));

/** Тариф проекта правят из реестра админа: строка проекта → «Править». */
async function openProjectTariff(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/admin/tariff');
  const row = page.locator('tbody tr', { hasText: box.title });
  await expect(row.first(), 'проект песочницы в реестре тарифов').toBeVisible({ timeout: 20_000 });
  await row.first().getByRole('button', { name: 'Править' }).click();
  await expect(page.locator('app-project-tariff')).toBeVisible();
  // «Дополнительно» свёрнуто: девять из десяти правок — это таблица
  // просмотров, а доплата за подписчиков живёт внутри.
  await page.locator('app-project-tariff summary', { hasText: 'Дополнительно' }).click();
}

test('ступени по подписчикам сохраняются и возвращаются с сервера', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.admin] as const,
  );
  await openProjectTariff(page);

  const subs = page.locator('app-project-tariff fieldset.tr-subs');
  await expect(subs, 'развилка по подписчикам стоит на экране').toBeVisible();

  // По умолчанию — «за одного»: так это работало до ступеней, и у
  // действующих проектов в снимке лежит именно ставка.
  const perOne = subs.getByRole('button', { name: /За одного/ });
  const stepped = subs.getByRole('button', { name: /Ступенями/ });
  await expect(perOne).toHaveAttribute('aria-pressed', 'true');
  await expect(stepped).toHaveAttribute('aria-pressed', 'false');

  await stepped.click();
  await expect(stepped).toHaveAttribute('aria-pressed', 'true');
  // Поле ставки исчезло: рядом со ступенями оно называло бы два разных
  // числа одной ценой.
  await expect(page.getByText('Подписчик: платит заказчик, ₽')).toHaveCount(0);

  // Пустая лесенка так и сказано — пустая, а не «доплата ноль».
  const table = page.locator('app-project-tariff table.tr-tbl').last();
  await expect(table).toContainText('Порогов нет');

  const addStep = page
    .locator('app-project-tariff')
    .getByRole('button', { name: '+ ступень' })
    .last();
  await addStep.click();
  const row = table.locator('tbody tr').first();
  await row.locator('input').nth(0).fill('10000');
  await row.locator('input').nth(1).fill('50000');
  await row.locator('input').nth(2).fill('30000');

  await page.locator('app-project-tariff').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.ant-message')).toContainText(/Тариф сохранён/, { timeout: 15_000 });

  // Возвращаемся с нуля: страница перечитывает тариф с сервера, и
  // ступени обязаны прийти оттуда, а не остаться в полях формы.
  await openProjectTariff(page);
  const again = page.locator('app-project-tariff fieldset.tr-subs');
  await expect(
    again.getByRole('button', { name: /Ступенями/ }),
    'форма открылась на той форме цены, которая сохранена',
  ).toHaveAttribute('aria-pressed', 'true');
  const savedRow = page.locator('app-project-tariff table.tr-tbl').last().locator('tbody tr');
  await expect(savedRow.locator('input').nth(0)).toHaveValue('10000');
  await expect(savedRow.locator('input').nth(1)).toHaveValue('50000');
  await expect(savedRow.locator('input').nth(2)).toHaveValue('30000');
});

test('нулевой порог ступени подписчиков не даёт сохранить и объясняет, что не так', async ({
  context,
  page,
}) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.admin] as const,
  );
  await openProjectTariff(page);

  const subs = page.locator('app-project-tariff fieldset.tr-subs');
  await subs.getByRole('button', { name: /Ступенями/ }).click();
  await page
    .locator('app-project-tariff')
    .getByRole('button', { name: '+ ступень' })
    .last()
    .click();

  const row = page.locator('app-project-tariff table.tr-tbl').last().locator('tbody tr').first();
  await row.locator('input').nth(0).fill('0');
  await row.locator('input').nth(1).fill('50000');

  // Объяснение стоит рядом со своими полями, а не над «Сохранить»: там
  // не видно, к какой из двух лесенок оно относится.
  await expect(page.locator('app-project-tariff .tr-bad').last()).toContainText('подписчиков');

  // И на сервер это не уезжает вовсе: отказ приходил бы всплывашкой,
  // которая гаснет, не показав виноватую строку.
  //
  // Проверяем кругом, а не отсутствием всплывашки: «всплывашки нет»
  // проходит мгновенно и при любом поведении. Открываем заново — если
  // битая лесенка всё же уехала, форма вернётся на ступенях.
  await page.locator('app-project-tariff').getByRole('button', { name: 'Сохранить' }).click();
  await openProjectTariff(page);
  await expect(
    page.locator('app-project-tariff fieldset.tr-subs').getByRole('button', { name: /За одного/ }),
    'ничего не сохранилось — форма открылась на прежней форме цены',
  ).toHaveAttribute('aria-pressed', 'true');
});
