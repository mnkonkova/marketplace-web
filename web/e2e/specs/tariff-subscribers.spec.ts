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

/**
 * Лесенка подписчиков живёт ВНУТРИ «Дополнительно», лесенка просмотров —
 * выше и снаружи. Адресуем через <details>, а не через `.last()`:
 * последняя таблица на странице — та, которая успела нарисоваться, и
 * клик по «+ ступень» успевал уехать в чужую лесенку.
 */
const subsBlock = (page: import('@playwright/test').Page) =>
  page.locator('app-project-tariff details');

/** Тариф проекта правят из реестра админа: строка проекта → «Править». */
async function openProjectTariff(
  page: import('@playwright/test').Page,
  sb: Sandbox = box,
): Promise<void> {
  await page.goto('/admin/tariff');
  const row = page.locator('tbody tr', { hasText: sb.title });
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
  const table = subsBlock(page).locator('table.tr-tbl');
  await expect(table).toContainText('Порогов нет');

  await subsBlock(page).getByRole('button', { name: '+ ступень' }).click();
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
  const savedRow = subsBlock(page).locator('table.tr-tbl tbody tr');
  await expect(savedRow.locator('input').nth(0)).toHaveValue('10000');
  await expect(savedRow.locator('input').nth(1)).toHaveValue('50000');
  await expect(savedRow.locator('input').nth(2)).toHaveValue('30000');
});

/**
 * Своя песочница: первый тест сохраняет лесенку, и проект после него уже
 * на ступенях. Этот тест проверяет, что битая лесенка НЕ сохраняется, —
 * то есть опирается на чистое состояние, которого в общей песочнице
 * после соседа не осталось бы.
 */
test.describe('отказ', () => {
  let bad: Sandbox;

  test.beforeAll(async () => {
    bad = await createSandbox('subsbad', { isTest: false });
  });

  test.afterAll(() => dropSandbox(bad));

  test('нулевой порог ступени подписчиков не даёт сохранить и объясняет, что не так', async ({
    context,
    page,
  }) => {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, bad.sessions.admin] as const,
    );
    await openProjectTariff(page, bad);

    const subs = page.locator('app-project-tariff fieldset.tr-subs');
    await subs.getByRole('button', { name: /Ступенями/ }).click();
    // Ждём пустую лесенку: без этого «+ ступень» успевал уехать в
    // лесенку просмотров, пока вторая таблица ещё не нарисовалась.
    await expect(subsBlock(page).locator('table.tr-tbl')).toContainText('Порогов нет');
    await subsBlock(page).getByRole('button', { name: '+ ступень' }).click();

    const row = subsBlock(page).locator('table.tr-tbl tbody tr').first();
    await row.locator('input').nth(0).fill('0');
    await row.locator('input').nth(1).fill('50000');

    // Объяснение стоит рядом со своими полями, а не над «Сохранить»: там
    // не видно, к какой из двух лесенок оно относится.
    await expect(subsBlock(page).locator('.tr-bad')).toContainText('подписчиков');

    // И сохранить нельзя вовсе: кнопка не нажимается, пока лесенка
    // битая. Это сильнее отказа с сервера — отказ приходил бы
    // всплывашкой, которая гаснет, не показав виноватую строку.
    const save = page
      .locator('app-project-tariff')
      .getByRole('button', { name: 'Сохранить тариф' });
    await expect(save, 'с нулевым порогом сохранять нечего').toBeDisabled();

    // Поправили порог — метка ушла, кнопка вернулась.
    await row.locator('input').nth(0).fill('10000');
    await expect(subsBlock(page).locator('.tr-bad')).toHaveCount(0);
    await expect(save).toBeEnabled();
  });
});
