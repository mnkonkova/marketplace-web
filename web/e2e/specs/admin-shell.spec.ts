import { test, expect, Page } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Оболочка админки: сводка, поиск, счётчики, журнал, команда и карточка
 * человека.
 *
 * Проверяем обещания, а не разметку. Сводка обещает, что каждый пункт
 * ведёт в отфильтрованный список, — значит после клика адрес несёт
 * фильтр. Счётчик у раздела обещает, что столько строк там и откроется, —
 * значит цифра в меню равна числу в списке. Поиск обещает не отнимать
 * клавиатуру: Escape закрывает, стрелки водят, фокус возвращается туда,
 * откуда открыли.
 *
 * Ничего необратимого здесь не нажимаем: стенд общий, роли не снимаем,
 * решения модерации не принимаем — смотрим, что экран их предлагает и
 * говорит правду о последствиях.
 */
const signIn = (context: import('@playwright/test').BrowserContext, role: 'admin' | 'manager') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

/** Приглушённый счётчик у пункта сайдбара — число, а не бейдж очереди. */
async function navCount(page: Page, label: string): Promise<number> {
  const item = page.locator('.crm-shell .side a.nav').filter({ hasText: label });
  const text = await item.locator('.n').first().innerText();
  return Number(text.trim());
}

test.describe('сводка', () => {
  test.beforeEach(async ({ context, page }) => {
    await signIn(context, 'admin');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Требует внимания' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('каждый пункт «Требует внимания» ведёт в список, суженный под него', async ({ page }) => {
    // «Без менеджера» — это фильтр по ответственному, а не просто переход
    // в проекты: раньше плашка вела на параметр, который никто не читал,
    // и открывался обычный список со всеми.
    await page.getByRole('button', { name: 'Назначить' }).click();
    await expect(page).toHaveURL(/\/admin\/projects\?.*manager=none/);
    await expect(page.locator('[data-test="projects-manager"]')).toContainText(
      'Без ответственного',
    );
  });

  test('пустые блоки не исчезают, а собираются в строку «Спокойно»', async ({ page }) => {
    // Пропавший блок читается как «не посчитали», а не как «там чисто»:
    // отличить эти два состояния по отсутствию строки невозможно.
    const calm = page.locator('.calm');
    await expect(calm).toBeVisible();
    await expect(calm).toContainText('Спокойно:');
  });

  test('журнал открывается целиком со сводки', async ({ page }) => {
    await page.getByRole('link', { name: 'Весь журнал' }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible();
  });
});

test('счётчик у раздела равен числу строк, которые откроются по клику', async ({
  context,
  page,
}) => {
  await signIn(context, 'admin');
  await page.goto('/admin');
  await expect(page.locator('.crm-shell .side a.nav').filter({ hasText: 'Проекты' })).toBeVisible({
    timeout: 15_000,
  });

  const badge = await navCount(page, 'Проекты');
  await page.locator('.crm-shell .side a.nav').filter({ hasText: 'Проекты' }).click();
  await expect(page).toHaveURL(/\/admin\/projects$/);

  // Цифра в меню и «Найдено» под фильтрами считают один и тот же набор:
  // разойдясь, они читаются как поломка списка.
  await expect(page.locator('[data-test="projects-total"]')).toHaveText(String(badge));
});

test.describe('поиск по CRM', () => {
  test.beforeEach(async ({ context, page }) => {
    await signIn(context, 'admin');
    await page.goto('/admin/projects');
    await expect(page.getByRole('button', { name: /Поиск по CRM/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('открывается с клавиатуры и кнопкой, Escape возвращает фокус на место', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /Поиск по CRM/ });
    await trigger.click();
    const palette = page.getByRole('dialog', { name: 'Поиск по CRM' });
    await expect(palette).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    // Фокус возвращается туда, откуда открыли: иначе следующий Tab
    // начинает обход страницы заново.
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('стрелки и Enter доводят до проекта, не трогая мышь', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('PetFlat');
    await expect(page.locator('.hits button').first()).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/manager\/projects\//, { timeout: 15_000 });
  });
});

test.describe('журнал', () => {
  test('фильтры живут в адресе и переживают перезагрузку', async ({ context, page }) => {
    await signIn(context, 'admin');
    await page.goto('/admin/audit');
    await expect(page.locator('[data-test="audit-object"]')).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-test="audit-object"] .ant-select-selector').click();
    // ng-zorro рисует вариант как nz-option-item без role=option — берём
    // его по классу, иначе локатор ждёт роль, которой у него нет.
    await page.locator('.ant-select-item-option').filter({ hasText: 'Проекты' }).click();
    await expect(page).toHaveURL(/object_type=project/);

    await page.reload();
    await expect(page.locator('[data-test="audit-object"]')).toContainText('Проекты');
  });
});

test.describe('команда', () => {
  test.beforeEach(async ({ context, page }) => {
    await signIn(context, 'admin');
    await page.goto('/admin/team');
    await expect(page.locator('[data-test="team-row"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test('человек, не открывавший ссылку, помечен отдельно от давно не заходивших', async ({
    page,
  }) => {
    // «Не входил» и «месяц назад» — разные вещи: первое значит, что
    // выданная ссылка так и не сработала, и это повод её перевыдать.
    await expect(page.getByText('Не входил').first()).toBeVisible();
  });

  test('ссылка для входа одноразовая и на почту не уходит', async ({ page }) => {
    const row = page.locator('[data-test="team-row"]').filter({ hasText: 'e2e-manager' });
    await row.getByRole('button', { name: /Действия/ }).click();
    await page.getByRole('menuitem', { name: 'Ссылка для входа' }).click();

    const dialog = page.getByRole('dialog', { name: 'Ссылка для входа' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText('72 часа');
    await expect(dialog).toContainText('Предыдущая ссылка перестала работать');
    // Отправки писем нет; кнопка «Отправить на почту» обещала бы то,
    // чего не происходит.
    await expect(dialog.getByRole('button', { name: /Отправить/ })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog).toBeHidden();
  });

  test('снятие роли у занятого менеджера предупреждает про проекты', async ({ page }) => {
    // 409 от сервера — не ошибка, а продолжение сценария: сначала дела,
    // потом роль. Проверяем, что экран говорит это до нажатия, а не после,
    // и что отказаться можно, ничего не сняв.
    const row = page.locator('[data-test="team-row"]').filter({ hasText: 'manager.test' });
    await row.getByRole('button', { name: /Действия/ }).click();
    await page.getByRole('menuitem', { name: 'Снять роль менеджера' }).click();

    await expect(page.getByText(/сначала спросим, кому их передать/)).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).first().click();
    await expect(page.getByText(/сначала спросим, кому их передать/)).toBeHidden();
  });

  test('карточка человека открывается из команды и не уводит со страницы', async ({ page }) => {
    await page.locator('[data-test="team-row"] button.person').first().click();
    const card = page.getByRole('dialog', { name: 'Карточка человека' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/team$/);

    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
  });
});

test('решение модерации принимают в карточке, где видно, на чём оно основано', async ({
  context,
  page,
}) => {
  await signIn(context, 'admin');
  await page.goto('/admin/moderation');
  await expect(page.getByRole('button', { name: 'Открыть' }).first()).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Открыть' }).first().click();
  const card = page.getByRole('dialog', { name: 'Карточка человека' });
  await expect(card).toBeVisible();

  // Одобрить можно сразу, а отклонить — только с причиной: её увидит
  // специалист, и «отклонено» без объяснения превращается в переписку.
  await expect(card.getByRole('button', { name: 'Одобрить' })).toBeVisible();
  await card.getByRole('button', { name: 'Отклонить с причиной' }).click();
  await expect(card.getByPlaceholder('Например')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('площадки в карточке: пять строк, незаполненные не исчезают', async ({ context, page }) => {
  await signIn(context, 'admin');
  await page.goto('/admin/moderation');
  await page.getByRole('button', { name: 'Открыть' }).first().click();
  const card = page.getByRole('dialog', { name: 'Карточка человека' });
  await expect(card).toBeVisible({ timeout: 15_000 });

  // «N из 5» считается по самому списку, и список показан целиком:
  // пропусти незаполненные — и заполненность придётся считать глазами
  // по дыркам.
  const block = card.locator('[data-test="platforms"]');
  await expect(block.getByRole('heading', { name: /Площадки · \d+ из 5/ })).toBeVisible();
  await expect(block.locator('.kv')).toHaveCount(5);
  await expect(block.locator('.kv').filter({ hasText: 'не заполнено' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('у человека без профиля специалиста площадок в карточке нет', async ({ context, page }) => {
  await signIn(context, 'admin');
  await page.goto('/admin/users?kind=client');
  await expect(page.locator('.user-row button.person').first()).toBeVisible({ timeout: 15_000 });

  await page.locator('.user-row button.person').first().click();
  const card = page.getByRole('dialog', { name: 'Карточка человека' });
  await expect(card).toBeVisible();
  // Площадок у заказчика не бывает — пустой блок про них был бы неправдой.
  await expect(card.locator('[data-test="platforms"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test.describe('проекты', () => {
  test.beforeEach(async ({ context, page }) => {
    await signIn(context, 'admin');
    await page.goto('/admin/projects');
    await expect(page.locator('[data-test="projects-total"]')).toBeVisible({ timeout: 15_000 });
  });

  test('по умолчанию открыты активные, завершённые — по явному выбору', async ({ page }) => {
    await expect(page.locator('[data-test="projects-status"]')).toContainText('Активные');
    // Пока адрес чист, фильтр по умолчанию в нём не пишется — но на
    // сервер уходит, иначе цифра в меню не сошлась бы со списком.
    await expect(page).toHaveURL(/\/admin\/projects$/);
  });

  test('ветка сужает список и попадает в адрес', async ({ page }) => {
    await page.locator('[data-test="projects-kind"] .ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'Креаторы' }).click();
    await expect(page).toHaveURL(/kind=creators_turnkey/);
    await expect(page.locator('[data-test="projects-share"]')).toContainText(
      'kind=creators_turnkey',
    );
  });

  test('возврат предлагают только отменённому проекту', async ({ page }) => {
    // У активного возвращать нечего, и пункт читался бы как «с проектом
    // что-то не так».
    const row = page.locator('[data-test="project-row"]').first();
    await row.getByRole('button', { name: /Действия/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Пометить тестовым' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Вернуть проект' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});

test('выключенные воронки и продакшены не лежат в общей куче', async ({ context, page }) => {
  await signIn(context, 'admin');
  await page.goto('/admin/pipelines');
  await expect(page.getByRole('heading', { name: 'Воронки продакшна' })).toBeVisible({
    timeout: 15_000,
  });

  // Выключенную воронку нельзя назначить, а выглядит она обычной строкой.
  // Цифра в меню считает действующие — список по умолчанию тоже.
  const shown = await page.locator('tbody tr').count();
  const badge = await navCount(page, 'Воронки');
  expect(shown).toBe(badge);
});
