import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Отбор в списках проектов: и у менеджера, и у админа.
 *
 * У менеджера поля отбора не было вовсе — свой проект искали глазами по
 * всей таблице, и «не нашёл» значило «пролистал мимо». Обещание простое:
 * набрал — список сузился, и ссылкой на эту выборку можно поделиться.
 * Последнее и есть то, что ломается молча: фильтр, не доехавший до
 * адреса, работает ровно до перезагрузки, а по присланной ссылке
 * открывается совсем другая выборка — с тем же видом экрана.
 *
 * У админа ровно так и было с веткой: параметр собирался и не уходил на
 * сервер. Выпадашка подсвечивалась, адрес менялся, набор оставался
 * прежним. Поэтому здесь проверяется не подсветка и не адрес, а СОСТАВ:
 * что уехало в запрос и что осталось в таблице.
 */
const signIn = (context: import('@playwright/test').BrowserContext, role: 'manager' | 'admin') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

const total = (page: Page) => page.locator('[data-test="projects-total"]');

test('менеджер сужает свой список запросом, и ссылка открывает ту же выборку', async ({
  context,
  page,
}) => {
  await signIn(context, 'manager');
  await page.goto('/manager/projects');
  await expect(total(page)).toBeVisible({ timeout: 15_000 });

  // Тестовые проекты мира показываем явно: без них у менеджера остаётся
  // одна строка, и «список сузился» не отличить от «список и так был
  // один». Заодно это ещё один фильтр, который обязан уехать в адрес.
  await page.locator('[data-test="projects-include-test"]').click();
  await expect(page).toHaveURL(/test=1/);
  const all = Number(await total(page).innerText());
  expect(all, 'мир кладёт три проекта на этого менеджера').toBeGreaterThan(1);

  await page.locator('[data-test="projects-search"]').fill('прошлые');
  await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
  await expect(total(page)).toHaveText('1');
  await expect(page.locator('table tbody tr.row')).toHaveCount(1);
  await expect(page.locator('table tbody tr.row').first()).toContainText('прошлые периоды');

  // Ссылка на выборку — та же выборка. Проверяем перезагрузкой того же
  // адреса: именно здесь фильтр, живущий только в памяти страницы,
  // тихо возвращает всё обратно.
  const link = page.url();
  await page.goto(link);
  await expect(total(page)).toHaveText('1', { timeout: 15_000 });
  await expect(page.locator('table tbody tr.row').first()).toContainText('прошлые периоды');
  await expect(
    page.locator('[data-test="projects-search"]'),
    'поле показывает, по чему сужено: пустое поле над одной строкой читается как «больше ничего нет»',
  ).toHaveValue('прошлые');

  // Ничего не нашлось — это тоже ответ, и он сказан словами.
  await page.locator('[data-test="projects-search"]').fill('такого проекта нет');
  await expect(page.getByText('Под текущие фильтры ничего не попало.')).toBeVisible();
});

test('у админа выбор ветки меняет набор, а не подсветку кнопки', async ({ context, page }) => {
  await signIn(context, 'admin');

  const sent: string[] = [];
  const answers: { search: string; kinds: string[] }[] = [];
  const pending: Promise<unknown>[] = [];
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (url.pathname !== '/api/v1/admin/projects') return;
    sent.push(url.search);
    pending.push(
      res.json().then(
        (body) =>
          answers.push({
            search: url.search,
            kinds: ((body.items ?? []) as { kind: string }[]).map((p) => p.kind),
          }),
        () => undefined,
      ),
    );
  });

  await page.goto('/admin/projects');
  await expect(page.locator('[data-test="project-row"]').first()).toBeVisible({ timeout: 15_000 });
  const before = Number(await total(page).innerText());

  await page.locator('[data-test="projects-kind"] .ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'Креаторы' }).click();
  await expect(page).toHaveURL(/kind=creators_turnkey/);

  // Отбор идёт на сервере, и главное здесь — что параметр туда доехал.
  // Он собирался и не клался в запрос: экран выглядел исправным.
  await expect
    .poll(() => sent.filter((s) => s.includes('kind=creators_turnkey')).length, {
      message: 'ветка обязана уехать в запрос, а не остаться на экране',
    })
    .toBeGreaterThan(0);

  // И набор действительно другой: проектов с воронкой на стенде больше,
  // чем с креаторами, так что сужение видно числом.
  await expect
    .poll(() => total(page).innerText().then(Number), {
      message: 'после выбора ветки список обязан стать другим',
    })
    .toBeLessThan(before);

  // И в таблице остались только они. Вида в колонках нет — смотрим в
  // ответ, который эту таблицу и наполнил: «на экране стало меньше» само
  // по себе могло бы означать что угодно.
  await Promise.all([...pending]);
  const filtered = answers.filter((a) => a.search.includes('kind=creators_turnkey'));
  expect(filtered.length, 'ответ на отфильтрованный запрос').toBeGreaterThan(0);
  const last = filtered[filtered.length - 1];
  expect(last.kinds.length, 'под ветку должно что-то попасть').toBeGreaterThan(0);
  for (const kind of last.kinds) expect(kind).toBe('creators_turnkey');
  await expect(page.locator('[data-test="project-row"]')).toHaveCount(last.kinds.length);
});
