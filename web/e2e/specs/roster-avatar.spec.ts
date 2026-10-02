import { test, expect } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { openManagerTab } from '../fixtures/ui';
import { callAs, createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Лица в карточке проекта.
 *
 * Состав читают глазами: один и тот же человек встречается в карточке
 * трижды — в составе, в плане выкладок и в ссылках. Пока ручка состава
 * не отдавала портрет, везде рисовались буквы имени, и три строки не
 * связывались в одного человека. Снаружи это выглядело как «аватарки
 * не подтягиваются», хотя подтягивать было нечего: поля в ответе не
 * существовало.
 *
 * Проверяем именно ТЕГ: буквы и фото — разная разметка, и зелёная
 * проверка «аватарка есть» ловила бы буквы наравне с портретом.
 */
const PORTRAIT =
  'https://storage.yandexcloud.net/wayprodmarket-dev/images/' +
  'ace988a4-dce5-43a8-b1f9-1ea4c7eb3f1d/04a97952-78e5-4c7c-a564-f1e66370350c.jpg';

let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('rosterava', { shape: 'stats', ownCreator: true });
  psql(
    `UPDATE specialist_profiles SET avatar_url = '${PORTRAIT}' ` +
      `WHERE user_id = '${box.creators[0].userId}';`,
  );
});

test.afterAll(() => dropSandbox(box));

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
});

test('портрет из профиля доезжает до состава, плана и ссылок', async ({ page }) => {
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'План выкладок');
  await expect(page.locator('.sec-plan')).toBeVisible({ timeout: 20_000 });

  // Ручка состава отдаёт адрес — без него фронту нечего рисовать.
  const roster = await callAs(
    box.manager,
    'get',
    `/api/v1/manager/projects/${box.projectId}/creators`,
  );
  const first = (roster.items ?? [])[0] as { avatar_url?: string };
  expect(first?.avatar_url, 'состав отдаёт портрет').toBe(PORTRAIT);

  // И он нарисован именно картинкой, а не буквами.
  const shot = await page.evaluate(() => ({
    photos: document.querySelectorAll('app-prmarket-ava img.ava').length,
    letters: document.querySelectorAll('app-prmarket-ava .ava.letters').length,
  }));
  expect(shot.photos, 'в карточке есть лица, а не только буквы').toBeGreaterThan(0);
});
