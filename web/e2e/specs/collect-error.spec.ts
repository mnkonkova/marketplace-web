import { test, expect } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/**
 * Ноль в отчёте должен быть подписан.
 *
 * Сборщик всегда говорит, почему цифр нет: «метрики отдельных постов для
 * vk пока не поддержаны», «ролик не найден», «кончились кредиты». Мы эту
 * причину выбрасывали, и в кабинете три разных положения выглядели
 * одинаково — пустой цифрой: площадка не собирается, ролик удалён, и
 * ролик живой, но его никто не посмотрел. Первые два — наша работа,
 * третье — работа креатора, и перепутать их стоило целого дня разбора
 * первого октября 2026.
 *
 * Здесь проверяется то, что видит человек: на месте нуля стоит причина,
 * а точный ответ сборщика доступен подсказкой.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('collecterr');
});

test.afterAll(() => dropSandbox(box));

/** Пометить ссылки проекта как несобравшиеся — ровно так это делает MarkFailed. */
function failLinks(projectId: string, reason: string): void {
  psql(`
DELETE FROM video_stat_daily WHERE link_id IN (
  SELECT l.id FROM publication_links l
  JOIN project_publications p ON p.id = l.publication_id
  WHERE p.project_id = '${projectId}');

UPDATE publication_links l
   SET last_collect_error = '${reason}',
       last_collect_try_at = now(),
       last_collected_at = NULL
  FROM project_publications p
 WHERE p.id = l.publication_id AND p.project_id = '${projectId}';`);
}

test('у менеджера на месте нуля — причина, а не цифра', async ({ context, page }) => {
  failLinks(box.projectId, "Метрики отдельных постов для ''vk'' пока не поддержаны");

  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.manager] as const,
  );
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Статистика');

  const cell = page.locator('td.nocount').first();
  await expect(cell).toBeVisible({ timeout: 20_000 });
  await expect(cell).toHaveText('площадка не собирается');
  // Исходный ответ сборщика остаётся виден: наша короткая подпись
  // устареет, когда на той стороне поменяют формулировку.
  await expect(cell).toHaveAttribute('title', /не поддержан/);
});

test('у креатора значок площадки подписан, а не пуст', async ({ context, page }) => {
  failLinks(box.projectId, 'Likee: ролик не найден или недоступен из этой сети');

  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.creator] as const,
  );
  await page.goto(`/me/creator/projects/${box.projectId}`);

  const mark = page.locator('.links-row .plat .nd-mark').first();
  await expect(mark).toBeVisible({ timeout: 20_000 });
  await expect(mark).toHaveText('ролик не найден');
});
