import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Проект, в котором не вышло ни одного ролика.
 *
 * Отсчёт периодов начинается с первой публикации, и пока её нет, считать
 * не от чего. Это состояние, а не сбой — но собрано оно из двух разных
 * ответов: денежная ручка отвечает отказом `no_periods`, а список
 * периодов — обычным пустым списком. Страница дёргает обе, и пока их
 * читают порознь, она умудряется показать пустое состояние И красный
 * тост одновременно: объяснение, почему чисел нет, и рядом сообщение,
 * что «что-то пошло не так».
 *
 * Поэтому смотрим оба ответа за один заход и проверяем ровно то, что
 * увидит человек: объяснение есть, ошибки нет, нулей нет. Ноль здесь
 * читался бы как «посчитали, и вышло ноль», — а не считали вовсе.
 */
const signIn = (context: import('@playwright/test').BrowserContext, role: 'manager' | 'client') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

/** Красный тост ng-zorro — то, чего на этом экране быть не должно. */
const toasts = (page: Page) => page.locator('.ant-message-notice');

test('у проекта без публикаций период не начался, и это сказано словами', async ({
  context,
  page,
}) => {
  await signIn(context, 'manager');

  // Обе ручки ловим за один заход: порознь каждая ведёт себя правильно,
  // а вместе дают экран с объяснением и ошибкой сразу.
  const answers: Record<string, number> = {};
  page.on('response', (res) => {
    const path = new URL(res.url()).pathname;
    if (/^\/api\/v1\/manager\/projects\/[^/]+\/billing$/.test(path)) answers['billing'] = res.status();
    if (path.endsWith('/billing/periods')) answers['periods'] = res.status();
  });

  await page.goto(`/manager/projects/${world().emptyProjectId}`);
  await page.getByRole('button', { name: 'Начисления' }).click();

  const empty = page.getByText(/Период начнётся с первого вышедшего ролика/);
  await expect(empty, 'вместо чисел — объяснение, почему их нет').toBeVisible({ timeout: 15_000 });

  expect(answers['billing'], 'денежная ручка отвечает отказом «периодов нет»').toBe(404);
  expect(answers['periods'], 'список периодов отвечает пустым списком, а не отказом').toBe(200);

  // Отказ по делу — не повод пугать человека: «нечего считать» это
  // состояние проекта, а не поломка.
  await expect(toasts(page)).toHaveCount(0);

  // И нулей нет: ни «К оплате 0 ₽», ни пустых плиток. Ноль — это ответ
  // на вопрос, который никто не задавал.
  await expect(page.getByText('Итого к выплате')).toHaveCount(0);
  await expect(page.locator('.bill .kpis')).toHaveCount(0);

  // Пересчитывать тоже нечего: кнопка обещала бы действие, которого нет.
  await expect(page.getByRole('button', { name: 'Пересчитать' })).toHaveCount(0);
});

test('заказчик на таком проекте видит то же объяснение, а не пустую карточку', async ({
  context,
  page,
}) => {
  await signIn(context, 'client');
  await page.goto(`/me/projects/${world().emptyProjectId}`);

  await expect(page.getByText(/Период начнётся с первого вышедшего ролика/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(toasts(page)).toHaveCount(0);
  // Счёта нет — ни за текущий период, ни за прошлый: платить пока не за что.
  await expect(page.locator('.billbar')).toHaveCount(0);
  await expect(page.locator('.duebar')).toHaveCount(0);
});
