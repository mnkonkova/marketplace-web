import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Открыли карточку — просмотры обновились.
 *
 * Цифры в кабинете живут снимками, а снимок делает сборщик по
 * расписанию. Для архива расписание ленивое, и это правильно: обход
 * стоит кредит у поставщика. Но у ролика, вышедшего час назад, то же
 * расписание означало «ноль до завтра», а ноль читается как «никто не
 * смотрит».
 *
 * Поэтому открытие карточки спрашивает сервер: обойди то, что устарело.
 * Кого именно — решает он, по возрасту ролика; наше дело — не забыть
 * спросить.
 *
 * Специя держит именно это «не забыть»: запрос должен уходить с КАЖДОЙ
 * карточки проекта. Первого октября 2026 он ушёл только с одной из двух
 * — у «креаторов под ключ» своя карточка, и там обхода не случалось
 * вовсе. Снаружи это выглядело как «открыла — не обошло».
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('refresh');
});

test.afterAll(() => dropSandbox(box));

test('карточка проекта у менеджера просит обойти площадки', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );

  const asked = page.waitForRequest(
    (r) => r.url().includes('/report/refresh') && r.method() === 'POST',
    { timeout: 20_000 },
  );
  await page.goto(`/manager/projects/${box.projectId}`);
  await asked;
});

test('кабинет креатора — тоже', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.creator] as const,
  );

  const asked = page.waitForRequest(
    (r) => r.url().includes('/report/refresh') && r.method() === 'POST',
    { timeout: 20_000 },
  );
  await page.goto(`/me/creator/projects/${box.projectId}`);
  await asked;
});
