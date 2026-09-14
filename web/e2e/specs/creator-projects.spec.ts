import { test, expect } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * «Мои проекты» у креатора — вход, которого до этого не было вовсе:
 * попасть на страницу выкладок можно было только по прямой ссылке.
 */
test.beforeEach(async ({ context }) => {
  const w = world();
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, w.sessions.creator] as const,
  );
});

test('креатор видит свой проект и открывает карточку', async ({ page }) => {
  const w = world();

  await page.goto('/me/creator/projects');
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();

  const card = page.getByText('PetFlat · UGC (e2e)');
  await expect(card, 'посеянный проект должен быть в списке').toBeVisible();

  await page.goto(`/me/creator/projects/${w.projectId}`);

  // Бриф — то, что раньше взять было неоткуда: страница собиралась из
  // списка выкладок, а описания проекта там нет.
  await expect(page.getByText('Вертикальные ролики про корм для кошек')).toBeVisible();
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
