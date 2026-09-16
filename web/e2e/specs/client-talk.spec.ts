import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab } from '../fixtures/ui';

/**
 * Заказчик пишет менеджеру со своей карточки проекта.
 *
 * Единственный способ что-то спросить по проекту, не выходя из системы, —
 * и поломка здесь тихая до неприличия: кнопка на месте, нажимается,
 * редактор выглядит рабочим, просто сообщение никуда не уходит. Человек
 * уверен, что написал, и ждёт ответа; менеджер уверен, что заказчик
 * молчит. Обнаруживается это через день разговором по телефону.
 *
 * Поэтому проверяем весь короткий путь целиком: написал — увидел в ленте
 * — редактор очистился. Пустой редактор здесь не украшение: он и есть
 * подтверждение отправки, а оставшийся текст читается как «не ушло», и
 * человек жмёт «Отправить» ещё дважды.
 *
 * Внутренних веток у заказчика нет: он видит один разговор, и вкладок
 * ему не показывают вовсе.
 */
const editor = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Комментарий' });

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
  box = await createSandbox('talk');
});

test.afterAll(() => dropSandbox(box));

test('заказчик отправляет комментарий, и тот появляется в ленте', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.client] as const,
  );
  await page.goto(`/me/projects/${box.projectId}`);

  // «Написать менеджеру» в шапке — короткая дорога к переписке: она
  // внизу длинной страницы, и без этой кнопки её просто не находят.
  await page.getByRole('button', { name: 'Написать менеджеру' }).click();

  const ed = editor(page);
  await expect(ed).toBeVisible({ timeout: 15_000 });

  // Текст уникальный: лента общая и переживает прогоны, а искать своё
  // сообщение по слову «привет» — значит однажды найти чужое.
  const text = `Вопрос от заказчика ${Date.now()}`;
  await ed.click();
  await ed.pressSequentially(text);

  const [sent] = await Promise.all([
    page.waitForResponse(
      (r) => /\/projects\/[^/]+\/comments$/.test(r.url()) && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Отправить' }).click(),
  ]);
  expect(sent.status(), await sent.text()).toBe(201);

  // Увидеть своё сообщение в ленте — и есть подтверждение, что оно ушло.
  const mine = page.locator('.thread .msg').filter({ hasText: text });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Вы');

  // И редактор пуст: оставшийся текст читается как «не отправилось».
  await expect(ed).toHaveText('');

  // Пустое сообщение не отправляется: лишняя строка в переписке —
  // это уведомление менеджеру ни о чём.
  const before = await page.locator('.thread .msg').count();
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.thread .msg')).toHaveCount(before);
});

test('заказчику не показывают внутренних веток переписки', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.client] as const,
  );
  await page.goto(`/me/projects/${box.projectId}`);
  // Переписка у заказчика теперь вкладка карточки, а не хвост длинной
  // страницы. Кнопка «Написать менеджеру» в шапке ведёт сюда же —
  // короткой дорогой, и она проверена тестом выше.
  await openClientTab(page, 'Переписка');
  await expect(editor(page)).toBeVisible({ timeout: 15_000 });

  // Вкладка «Только менеджерам» у заказчика — это не запрет доступа, а
  // обещание, что такая переписка есть и её от него прячут.
  await expect(page.getByRole('tab', { name: 'Только менеджерам' })).toHaveCount(0);
  await expect(page.locator('.thread .msg.internal')).toHaveCount(0);
});
