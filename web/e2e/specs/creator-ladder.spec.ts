import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Шкала ступеней в кабинете креатора.
 *
 * Отвечает на один вопрос — «что мне сделать прямо сейчас», — и обе его
 * половины ломаются молча. Ступень одна на всех и равна 100 000: собьётся
 * шаг — человек будет считать до ступени, которой нет, и поймёт это
 * только когда не получит её. А «типичный ролик» приходит с сервера по
 * лесенке «своя история → медиана проекта → средний по площадке», и
 * подпись рядом с числом — единственное, по чему видно, на чьих данных
 * посчитано обещание «до ступени 20 роликов». Подпись от неверной ветки
 * выглядит совершенно правдоподобно.
 *
 * Поэтому число не сверяем — оно меняется от прогона к прогону и живёт на
 * сервере. Сверяем ШАГ ступеней и СООТВЕТСТВИЕ подписи тому, что пришло
 * в ответе.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

/** Ступень тарифа. Такая же константа, как в приложении, и это намеренно. */
const LADDER_STEP = 100_000;

/**
 * Подписи источника — переписаны сюда, а не позваны из приложения:
 * позвать значило бы проверить словарь самим собой.
 */
const SOURCE_NOTE: Record<string, string> = {
  creator: 'по твоим роликам',
  project: 'по роликам проекта',
  default: 'средний ролик по площадке',
};

/**
 * «2,1 млн» и «300 тыс.» обратно в число.
 *
 * Разбираем то, что нарисовано, а не то, что посчитано: шаг ступеней
 * человек читает глазами по этим подписям, и проверять надо именно их.
 * Ступени всегда кратны сотне тысяч, так что дробной части больше одного
 * знака тут не бывает.
 */
function views(text: string): number {
  const t = text.replace(/ /g, ' ').trim();
  const m = /^([\d ]+(?:,\d+)?)\s*(млн|тыс\.)?$/.exec(t);
  if (!m) throw new Error(`не похоже на просмотры: «${text}»`);
  const n = Number(m[1].replace(/ /g, '').replace(',', '.'));
  if (m[2] === 'млн') return Math.round(n * 1_000_000);
  if (m[2] === 'тыс.') return Math.round(n * 1000);
  return n;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.creator] as const,
  );
});

test('ступени идут по 100 000, и следующая — первая, которую ещё не взяли', async ({ page }) => {
  await page.goto(`/me/creator/projects/${world().historyProjectId}`);
  const ladder = page.locator('app-creator-ladder');
  await expect(ladder.getByRole('heading', { name: 'Ступени по просмотрам' })).toBeVisible({
    timeout: 15_000,
  });

  const marks = await ladder.locator('.marks li .v').allInnerTexts();
  expect(marks.length, 'шкала показывает окно вокруг текущего положения').toBeGreaterThan(1);

  const numbers = marks.map(views);
  for (let i = 1; i < numbers.length; i += 1) {
    expect(numbers[i] - numbers[i - 1], `ступени ${marks[i - 1]} и ${marks[i]}`).toBe(LADDER_STEP);
  }

  // Следующая ступень — та, до которой считают «сколько осталось».
  // Разъедься эти два числа, и человек будет копить не туда.
  const now = views(await ladder.locator('.now b').innerText());
  const next = numbers[numbers.length - 1];
  expect(next, 'следующая ступень — первая выше текущего счёта').toBeGreaterThan(now);
  expect(next - LADDER_STEP, 'и ровно одна ступень назад уже пройдена').toBeLessThanOrEqual(now);

  const left = views(
    (await ladder.locator('.lead').innerText()).replace(/^До следующей ступени\s*/, '').split(' —')[0],
  );
  expect(left, 'до ступени осталось ровно столько, сколько до неё и есть').toBe(next - now);
});

test('у типичного ролика сказано, на чьих данных он посчитан', async ({ page }) => {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.creator.access_token}` },
  });
  const earnings = await (
    await api.get(`/api/v1/me/creator/projects/${world().historyProjectId}/earnings`)
  ).json();
  await api.dispose();

  const source = earnings?.benchmark?.typical_video_source as string | undefined;
  expect(source, 'ориентир по роликам обязан приходить с сервера').toBeTruthy();
  const note = SOURCE_NOTE[source!];
  expect(note, `неизвестный источник типичного ролика: ${source}`).toBeTruthy();

  await page.goto(`/me/creator/projects/${world().historyProjectId}`);
  const typical = page.locator('app-creator-ladder .typ');
  await expect(typical).toBeVisible({ timeout: 15_000 });

  // Подпись стоит рядом с числом, а не в подсказке: «по твоим роликам» и
  // «средний ролик по площадке» — разные обещания, и второе не должно
  // выдавать себя за первое.
  await expect(typical, `ответ говорит «${source}»`).toContainText(note);
  for (const [other, text] of Object.entries(SOURCE_NOTE)) {
    if (other !== source) await expect(typical).not.toContainText(text);
  }
});
