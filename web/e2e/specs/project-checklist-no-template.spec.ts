import { test, expect } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Пункт чеклиста заводится и без подключённой библиотеки.
 *
 * Библиотека — для требований, которые повторяются из проекта в проект.
 * У разового проекта их может не быть вовсе, а «логотип в первые три
 * секунды» сказать всё равно надо. Раньше здесь был тупик: при пустом
 * чеклисте форма добавления не рисовалась вовсе, а на её месте стояла
 * отсылка «возьмите шаблон из библиотеки» — то есть завести один пункт
 * было нечем, кроме как заведя ради него библиотечную запись и испортив
 * её всем остальным проектам.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('ckempty');
});

test.afterAll(() => dropSandbox(box));

test('без шаблона пункт проекта всё равно заводится', async ({ context, page }) => {
  // Отцепляем всё, что подключилось автоматически: проверяем именно
  // пустое состояние.
  psql(`
DELETE FROM project_checklist_items WHERE project_id = '${box.projectId}';
DELETE FROM project_checklist_snapshot WHERE project_id = '${box.projectId}';`);

  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${box.projectId}`);
  // Карточка показывает по одному разделу за раз; чеклист живёт в
  // «Проверке» рядом с разбором роликов.
  await page.locator('.secnav').getByRole('button', { name: 'Проверка' }).click();

  const block = page.locator('.ck-block');
  await expect(block).toBeVisible({ timeout: 20_000 });
  // Отсылка к библиотеке осталась, но она больше не единственный выход.
  await expect(block.locator('.empty')).toContainText('добавить пункты этого проекта');

  const field = block.getByPlaceholder('Добавить пункт для этого проекта');
  await expect(field, 'форма доступна и при пустом чеклисте').toBeVisible();
  await field.fill('Логотип в первые 3 секунды');

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/checklist/items') && r.request().method() === 'POST',
    ),
    block.getByRole('button', { name: 'Добавить' }).click(),
  ]);
  expect(res.status(), await res.text()).toBe(201);

  // И он сразу виден в списке — тем же, что увидит креатор при сдаче.
  await expect(block.locator('.ck-list')).toContainText('Логотип в первые 3 секунды');
});
