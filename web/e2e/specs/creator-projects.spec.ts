import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * «Мои проекты» у креатора — вход, которого до этого не было вовсе:
 * попасть на страницу выкладок можно было только по прямой ссылке.
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.creator] as const,
  );
});

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
  box = await createSandbox('crprojects');
});

test.afterAll(() => dropSandbox(box));

test('креатор видит свой проект и открывает карточку', async ({ page }) => {
  await page.goto('/me/creator/projects');
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();

  const card = page.getByText(box.title);
  await expect(card, 'посеянный проект должен быть в списке').toBeVisible();

  await page.goto(`/me/creator/projects/${box.projectId}`);

  // Бриф — то, что раньше взять было неоткуда: страница собиралась из
  // списка выкладок, а описания проекта там нет.
  await expect(page.getByText(box.notes)).toBeVisible();
});

test('чужой проект креатору не открывается', async ({ page }) => {
  await page.goto('/me/creator/projects/00000000-0000-0000-0000-000000000000');

  // До этого теста страница показывала обычный пустой проект: «выкладок
  // пока нет — менеджер ещё не проставил даты». По чужому проекту это
  // неправда, по несуществующему — вдвойне.
  await expect(page.getByRole('heading', { name: 'Проект не найден' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Выкладок пока нет')).toHaveCount(0);
});
