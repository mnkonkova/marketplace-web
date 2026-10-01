import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Ступень прайса: завести, поправить, убрать.
 *
 * Раньше «Добавить ступень» вставляла строку с порогом НОЛЬ. Ноль —
 * не пустой ввод, а настоящее значение, и именно оно у прайса уже
 * занято нижней ступенью. Сервер на это отвечал «две ступени с одним
 * порогом», и прайс переставал выпускаться целиком: ни добавить новую,
 * ни убрать её — отказ приходил всплывашкой, гас, а строки оставались
 * на вид одинаковыми, и какую из них править, было не видно.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('steps');
});

test.afterAll(() => dropSandbox(box));

test('новая ступень просит порог, а не встаёт нулём', async ({ context, page }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.admin] as const,
  );
  await page.goto('/admin/tariff');
  await page.getByRole('button', { name: 'Шаблон площадки' }).click();
  await page.getByRole('button', { name: /Выпустить версию прайса/ }).click();

  const rows = page.locator('.step-row');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const before = await rows.count();

  await page.getByRole('button', { name: 'Добавить ступень' }).click();
  await expect(rows).toHaveCount(before + 1);

  const fresh = rows.nth(before);
  // Порог пустой, строка помечена — видно, что именно доделать.
  await expect(fresh.locator('input').first()).toHaveValue('');
  await expect(fresh).toHaveClass(/bad/);
  await expect(fresh.locator('.step-bad')).toHaveText('не задан порог');

  // С такой строкой прайс не уходит на сервер вовсе: отказ приходил бы
  // всплывашкой, не показывая, какая строка виновата.
  await page.getByRole('button', { name: 'Выпустить версию', exact: true }).click();
  await expect(page.locator('.step-row.bad')).toHaveCount(1);

  // Заполнили порог — метка ушла.
  // Порог считаем от уже стоящих: прайс общий, и прибитое число
  // однажды совпало бы с чужой ступенью — специя падала бы «сама по
  // себе».
  const taken = await rows.evaluateAll((els) =>
    els.map((e) => Number((e.querySelector('input') as HTMLInputElement).value || 0)),
  );
  const free = String(Math.max(...taken) + 12345);
  await fresh.locator('input').first().fill(free);
  await expect(fresh).not.toHaveClass(/bad/);

  // Повтор чужого порога виден так же — и тоже по строке, а не словами
  // в всплывашке.
  const first = await rows.first().locator('input').first().inputValue();
  await fresh.locator('input').first().fill(first);
  await expect(fresh.locator('.step-bad')).toHaveText('такой порог уже есть');

  // И убирается.
  await fresh.getByRole('button', { name: 'Убрать' }).click();
  await expect(rows).toHaveCount(before);
  await expect(page.locator('.step-row.bad')).toHaveCount(0);
});
