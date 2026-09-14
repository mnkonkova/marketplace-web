import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Что креатор видит про свой заработок и ближайшую ступень.
 *
 * Экран отвечает на один вопрос — «сколько мне за это будет», — и обе
 * половины ответа ломаются молча. Числа считает сервер: заработанное
 * приходит начислением, прибавка за ступень — прогнозом, и вторая копия
 * расчёта в браузере разошлась бы с настоящей выплатой на первой же
 * правке ставок. Разошлась бы тихо: на экране стояло бы правдоподобное
 * число, а узнали бы о разнице в день выплаты.
 *
 * Поэтому здесь не проверяется арифметика — она покрыта на сервере.
 * Проверяется, что экран показывает ИМЕННО ТО, что посчитал сервер, и
 * что прибавка названа прогнозом, а не начисленным: «примерно» здесь не
 * вежливость, а единственное, что отличает обещание от долга.
 *
 * Вторая половина — подпись под типичным роликом. Ориентир приходит по
 * лесенке «своя история → медиана проекта → средний по площадке», и
 * подпись от неверной ветки выглядит совершенно правдоподобно. Поэтому
 * сверяем её с тем, что пришло в ответе, а не с ожидаемым текстом.
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
 * Разбираем то, что нарисовано, а не то, что посчитано: человек читает
 * эти подписи глазами, и проверять надо именно их. До ступени всегда
 * меньше сотни тысяч, так что округления «млн» сюда не попадают.
 */
function views(text: string): number {
  const t = text.replace(/\u00a0/g, ' ').trim();
  const m = /^([\d ]+(?:,\d+)?)\s*(млн|тыс\.)?$/.exec(t);
  if (!m) throw new Error(`не похоже на просмотры: «${text}»`);
  const n = Number(m[1].replace(/ /g, '').replace(',', '.'));
  if (m[2] === 'млн') return Math.round(n * 1_000_000);
  if (m[2] === 'тыс.') return Math.round(n * 1000);
  return n;
}

/**
 * Копейки → та же строка, что рисует formatMoney на экране.
 *
 * Повторяем форматирование намеренно: сравнивать надо ТЕКСТ на экране с
 * ЧИСЛОМ, которое отдал сервер.
 */
function money(kopecks: number): string {
  const nbsp = '\u00a0';
  const rub = Math.floor(kopecks / 100);
  const head = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  const kop = kopecks % 100;
  return kop === 0 ? `${head}${nbsp}₽` : `${head},${String(kop).padStart(2, '0')}${nbsp}₽`;
}

interface Earnings {
  benchmark?: { typical_video_source?: string };
  next_step_forecast?: { step_views: number; views_to_go: number; forecast_payout: number };
}

/** Заработок креатора по проекту — как его посчитал сервер. */
async function earnings(): Promise<Earnings> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.creator.access_token}` },
  });
  const res = await api.get(`/api/v1/me/creator/projects/${world().historyProjectId}/earnings`);
  const body = (await res.json()) as Earnings;
  await api.dispose();
  return body;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.creator] as const,
  );
});

test('до ступени показано ровно столько, сколько посчитал сервер', async ({ page }) => {
  const step = (await earnings()).next_step_forecast;
  expect(step, 'прогноз ступени обязан приходить с сервера').toBeTruthy();
  expect(step!.step_views, 'ступень одна на всех и равна ста тысячам').toBe(LADDER_STEP);

  await page.goto(`/me/creator/projects/${world().historyProjectId}`);
  const ladder = page.locator('app-creator-ladder');
  await expect(ladder.getByRole('heading', { name: 'Заработок за период' })).toBeVisible({
    timeout: 15_000,
  });

  // Просмотры до ступени — те же, что в прогнозе. Своя арифметика в
  // браузере разошлась бы с серверной молча: на экране стояло бы
  // правдоподобное число.
  const line = await ladder.locator('.views-line').innerText();
  const shown = /До ступени\s+(.+?)\s+(?:просмотр|просмотра|просмотров)/.exec(line);
  expect(shown, `не разобрать строку «${line}»`).toBeTruthy();
  expect(views(shown![1]), 'до ступени — из прогноза, а не из своего расчёта').toBe(
    step!.views_to_go,
  );

  // Прибавка названа прогнозом. Слово «примерно» здесь не вежливость:
  // куда лягут будущие просмотры — в полную ставку или в пониженную
  // после порога, — заранее не знает никто, и обещать сумму нельзя.
  const gain = ladder.locator('.gain');
  await expect(gain).toContainText(money(step!.forecast_payout));
  await expect(gain).toContainText(/прогноз/);
  await expect(ladder.locator('.ends .to')).toContainText('на следующей ступени');
});

test('у типичного ролика сказано, на чьих данных он посчитан', async ({ page }) => {
  const source = (await earnings()).benchmark?.typical_video_source;
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
