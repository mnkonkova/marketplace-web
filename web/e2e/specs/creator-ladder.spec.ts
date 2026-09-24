import { test, expect, type Locator, type Page, request as pwRequest } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Что креатор видит про свой заработок и ближайшую ступень.
 *
 * Экран отвечает на один вопрос — «сколько мне за это будет», — и обе
 * половины ответа ломаются молча. Числа считает сервер: заработанное
 * приходит начислением, прибавка за ступень и остаток до неё —
 * прогнозом (`next_step_forecast`), и считает его тот же код, что и
 * настоящую выплату. Вторая копия расчёта в браузере разошлась бы с
 * серверной на первой же правке ставок. Разошлась бы тихо: на экране
 * стояло бы правдоподобное число, а узнали бы о разнице в день выплаты.
 *
 * Поэтому здесь не проверяется арифметика — она покрыта на сервере.
 * Проверяется, что экран показывает ИМЕННО ТО, что посчитал сервер. И
 * проверяется это подменой ответа: сверить нарисованное с пришедшим мало
 * — совпасть они могут и случайно, когда браузер считает то же самое из
 * тех же просмотров. А вот подставленный прогноз, которого из измеренных
 * чисел не выводится никак, отличает «показал присланное» от «посчитал
 * сам» однозначно.
 *
 * Оговорка про прогноз теперь глифом, а не словом: «≈» перед суммой и
 * пометка «Предварительно» над карточкой. Слова «прогноз» рядом с суммой
 * больше нет — это решение владельца продукта, и сторожить его нечем.
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

/** Неразрывные пробелы и переносы — в обычные: сравниваем текст, а не вёрстку. */
function norm(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  box = await createSandbox('ladder', { shape: 'history' });
});

test.afterAll(() => dropSandbox(box));

interface Forecast {
  step_views: number;
  views_to_go: number;
  forecast_payout: number;
}

interface Earnings {
  benchmark?: { typical_video_views?: number; typical_video_source?: string };
  next_step_forecast?: Forecast;
  // Перенос прошлого периода — им подменяем просмотры, по которым
  // рисуется лесенка. Поля описаны ровно те, что спека трогает: полный
  // тип ответа живёт в приложении, и копия его здесь устарела бы молча.
  period?: { carry_in_creator?: number } & Record<string, unknown>;
}

/** Заработок креатора по проекту — как его посчитал сервер. */
async function earnings(): Promise<Earnings> {
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${box.sessions.creator.access_token}` },
  });
  const res = await api.get(`/api/v1/me/creator/projects/${box.projectId}/earnings`);
  const body = (await res.json()) as Earnings;
  await api.dispose();
  return body;
}

/**
 * Подменить прогноз в ответе сервера.
 *
 * Здесь и проходит граница между «показал присланное» и «посчитал сам»:
 * подставленные числа из измеренных просмотров не выводятся никак, и
 * браузер, который считает сам, нарисует своё.
 *
 * `patch` возвращает новый прогноз или null — «прогноза нет вовсе».
 */
async function withForecast(
  page: Page,
  patch: (e: Earnings) => Partial<Earnings> | null,
): Promise<void> {
  await page.route('**/creator/projects/*/earnings*', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Earnings;
    const next = patch(body);
    const json = next === null ? { ...body, next_step_forecast: null } : { ...body, ...next };
    await route.fulfill({ response: res, json });
  });
}

/**
 * Открыть кабинет креатора по проекту с прошлым и дождаться шкалы.
 *
 * Деньги периода и лесенка живут прямо в карточке проекта — отдельного
 * виджета у креатора больше нет.
 */
async function openLadder(page: Page): Promise<Locator> {
  await page.goto(`/me/creator/projects/${box.projectId}`);
  const ladder = page.locator('.earn');
  await expect(ladder, 'деньги периода нарисованы').toBeVisible({ timeout: 15_000 });
  await expect(ladder.locator('.stairs .step').first(), 'лесенка нарисована').toBeVisible({
    timeout: 15_000,
  });
  return ladder;
}

/**
 * Прибавка за следующий ролик — число из блока «≈ + N ₽».
 *
 * Прибавка и остаток до ступени стоят теперь в разных местах экрана:
 * сумма — в блоке добора справа, остаток — в подписи лесенки. Это одно
 * и то же правило («числа считает сервер»), просто разложенное по двум
 * строкам.
 */
function parseGain(text: string): string {
  const t = norm(text);
  const payout = /≈\s*\+\s*([\d  ,]+₽)/.exec(t);
  if (!payout) throw new Error(`не разобрать прибавку: «${t}»`);
  return payout[1].trim();
}

/** Сколько просмотров осталось до ступени — из подписи лесенки. */
function parseToGo(text: string): number {
  const m = /До следующей\s*—?\s*([\d ]+)\s*просмотр/.exec(norm(text));
  if (!m) throw new Error(`не разобрать остаток до ступени: «${norm(text)}»`);
  return views(m[1]);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.creator] as const,
  );
});

test('прибавка и остаток до ступени показаны ровно те, что посчитал сервер', async ({ page }) => {
  const body = await earnings();
  const step = body.next_step_forecast;
  expect(step, 'прогноз ступени обязан приходить с сервера').toBeTruthy();
  expect(step!.step_views, 'ступень одна на всех и равна ста тысячам').toBe(LADDER_STEP);

  const ladder = await openLadder(page);

  // Оба числа — из прогноза. Своя арифметика в браузере разошлась бы с
  // серверной молча: на экране стояло бы правдоподобное число.
  expect(
    parseGain(await ladder.locator('.lever').innerText()),
    'прибавка — из forecast_payout',
  ).toBe(norm(money(step!.forecast_payout)));
  expect(parseToGo(await ladder.locator('.earn-sub').innerText()), 'остаток — из views_to_go').toBe(
    step!.views_to_go,
  );

  // Оговорка, что это прогноз, а не начисленное: «≈» перед суммой.
  // Словом её больше не пишут — ни «примерно», ни «прогноз».
  await expect(ladder.locator('.lever')).toContainText('≈');
  expect(body.benchmark, 'ориентир по роликам приходит с сервера').toBeTruthy();
});

test('подменённый прогноз меняет экран: числа приходят с сервера, а не считаются в браузере', async ({
  page,
}) => {
  // Числа заведомо чужие: из измеренных просмотров проекта они не
  // выводятся никак. Браузер, который считает сам, нарисует своё — и
  // именно это здесь и ловится.
  const fake: Forecast = { step_views: LADDER_STEP, views_to_go: 37_000, forecast_payout: 123_456 };
  // Типичный ролик кладём мелким, чтобы строка «до ступени» ушла в ветку
  // с числом: иначе проверять на ней нечего.
  await withForecast(page, (e) => ({
    next_step_forecast: fake,
    benchmark: { ...(e.benchmark ?? {}), typical_video_views: 1000 },
  }));

  const ladder = await openLadder(page);

  expect(
    parseGain(await ladder.locator('.lever').innerText()),
    'на экране прибавка из ответа, а не своя',
  ).toBe(norm(money(123_456)));
  expect(
    parseToGo(await ladder.locator('.earn-sub').innerText()),
    'на экране остаток из ответа, а не свой',
  ).toBe(37_000);
});

/**
 * То же правило, но про РИСУНОК, а не про подписи.
 *
 * Полосы прогресса на шкале нет — она мерила долю внутри одной ступени,
 * и на сороковой ступени человек видел четыре пикселя заливки, то есть
 * «ты ничего не заработал». Вместо неё лесенка: насечка = 100 тысяч
 * просмотров, и рисуется она окном вокруг взятой ступени. Проверка при
 * этом та же: нарисованное обязано идти за числами СЕРВЕРА, а не за
 * арифметикой браузера.
 *
 * Меряем приростом, а не абсолютом: сколько ступеней у песочницы сейчас
 * — дело посева, а «добавили ровно три ступени переноса — стало ровно
 * на три больше» держится при любом посеве.
 */
test('лесенка растёт ровно на столько ступеней, на сколько выросли просмотры с сервера', async ({
  page,
}) => {
  const passed = async (l: Locator): Promise<number> => {
    const m = /Взято\s+(\d+)\s+ступен/.exec(norm(await l.locator('.earn-sub').innerText()));
    if (!m) throw new Error(`не разобрать число ступеней: «${norm(await l.innerText())}»`);
    return Number(m[1]);
  };

  const before = await passed(await openLadder(page));

  await withForecast(page, (e) => ({
    period: { ...e.period, carry_in_creator: (e.period?.carry_in_creator ?? 0) + 3 * LADDER_STEP },
  }));

  const after = await passed(await openLadder(page));
  expect(after - before, 'ступени считает сервер, а не браузер').toBe(3);
});

test('прибавка и кнопка добора стоят рядом: сумма объясняет, зачем нажимать', async ({ page }) => {
  // Прибавка стояла тихой строкой под мотивирующей фразой, а кнопка —
  // отдельно: экран звал нажать, не сказав зачем. Решает человек СУММОЙ,
  // поэтому сумма и кнопка обязаны быть одним блоком.
  await withForecast(page, (e) => ({
    next_step_forecast: { step_views: LADDER_STEP, views_to_go: 20_000, forecast_payout: 50_000 },
    benchmark: { ...(e.benchmark ?? {}), typical_video_views: 40_000 },
  }));

  const ladder = await openLadder(page);
  const lever = ladder.locator('.lever');
  expect(parseGain(await lever.innerText())).toBe(norm(money(50_000)));
  await expect(
    lever.getByRole('button', { name: /Взять ещё выкладку/ }),
    'кнопка добора — в том же блоке, что и сумма',
  ).toBeVisible();
});

test('прогноза нет — строки с числами нет вовсе', async ({ page }) => {
  // Пустой тариф или проект без периодов: считать нечего. Выдуманному
  // числу на экране взяться неоткуда, и строка обязана исчезнуть целиком
  // — прочерк вместо суммы читался бы как «ступень ничего не добавит».
  await withForecast(page, () => null);

  const ladder = await openLadder(page);
  await expect(ladder.locator('.lever'), 'без прогноза прибавку показывать нечем').toHaveCount(0);
  // Сама лесенка при этом на месте: сколько ступеней взято — это факт
  // периода, а не прогноз, и прятать его вместе с прогнозом нельзя.
  await expect(ladder.locator('.stairs .step').first()).toBeVisible();
});

test('сказано, на чьих данных посчитан следующий ролик', async ({ page }) => {
  // «По вашей медиане» и «типовой ролик» — РАЗНЫЕ обещания, и второе не
  // должно выдавать себя за первое: по этой строке человек считает свою
  // зарплату. Своя медиана есть — называем её и число роликов, на
  // которых она посчитана; нет — честно говорим про справочник.
  const ladder = await openLadder(page);
  const note = norm(await ladder.locator('.lever p').innerText());

  const mine = /по вашей медиане за \d+ ролик/.test(note);
  const book = /типовой ролик, ваших пока мало для своей медианы/.test(note);
  expect(mine || book, `строка не говорит, чьи это данные: «${note}»`).toBe(true);
  expect(mine && book, 'два разных источника разом — это неправда об одном из них').toBe(false);
});
