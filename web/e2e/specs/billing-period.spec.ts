import {
  test,
  expect,
  type Page,
  request as pwRequest,
  type APIRequestContext,
} from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * Период проекта: как он подписан и что про него сказано.
 *
 * Период не совпадает с календарным месяцем — он начинается днём первой
 * публикации и катится от неё. Подпись «сентябрь» здесь не просто
 * неточность: она врёт ровно в том месте, где человек и должен заметить
 * разницу, и заметить подмену по экрану нельзя — «сентябрь» выглядит
 * совершенно нормально.
 *
 * Вторая тихая поломка — две пометки состояния. «Предварительно» значит
 * «подожди, числа ещё изменятся»: период идёт. «Данные приблизительные»
 * значит обратное — период уже подытожен, но поденной статистики за него
 * не осталось, и числа подтянуты, а не измерены. Схлопни их в одну
 * плашку или подставь не ту — и человек сделает не то действие, а
 * выглядеть это будет одинаково. На сервере у второй пометки покрытия
 * нет вовсе: браузер тут единственный, кто на неё смотрит.
 *
 * Подытоженный период приготовлен данными, а не ожиданием: подытог
 * ставит воркер через две недели после конца периода, и перемотать это
 * время браузером нельзя.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

const signIn = (
  context: import('@playwright/test').BrowserContext,
  role: 'manager' | 'client' | 'admin',
) =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions[role]] as const,
  );

interface Period {
  seq: number;
  starts_on: string;
  ends_on: string;
  status: 'open' | 'locked';
  snapshot_as_of?: string;
  snapshot_approx?: boolean;
}

async function managerApi(): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${world().sessions.manager.access_token}` },
  });
}

/** Периоды проекта с сервера: правило периода живёт там, а не здесь. */
async function periodsOf(projectId: string): Promise<Period[]> {
  const api = await managerApi();
  const res = await api.get(`/api/v1/manager/projects/${projectId}/billing/periods`);
  const items = ((await res.json()).items ?? []) as Period[];
  await api.dispose();
  return items;
}

/**
 * Родительный падеж — тот же список, что в приложении, и переписан сюда
 * намеренно: позвать функцию приложения значило бы проверить её самой
 * собой. Сравниваем ТЕКСТ на экране с ДАТОЙ, пришедшей от сервера.
 */
const MONTHS_OF = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/**
 * «31 июля» из метки времени.
 *
 * Разбираем ISO-строку по частям, а не через Date: границы периода —
 * календарные дни, присланные полуночью UTC, и часовой пояс прогона
 * сдвинул бы их на сутки.
 */
function day(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`не дата: ${iso}`);
  return `${Number(m[3])} ${MONTHS_OF[Number(m[2]) - 1]}`;
}

/** «Период 2 · 31 августа — 30 сентября». */
function title(p: Period): string {
  return `Период ${p.seq} · ${day(p.starts_on)} — ${day(p.ends_on)}`;
}

/** Строка состояния над начислениями: номер, границы и пометки. */
const periodLine = (page: Page) => page.locator('.period-line');

/** Открыть вкладку «Начисления» в карточке проекта у менеджера. */
async function openBilling(page: Page, projectId: string): Promise<void> {
  await page.goto(`/manager/projects/${projectId}`);
  await page.getByRole('button', { name: 'Начисления' }).click();
  await expect(periodLine(page)).toBeVisible({ timeout: 15_000 });
}

test('период подписан датами, а не названием месяца', async ({ context, page }) => {
  const periods = await periodsOf(world().historyProjectId);
  const current = periods.find((p) => p.status === 'open');
  expect(current, 'у проекта с прошлым должен идти текущий период').toBeTruthy();

  // Проверка имеет смысл только на периоде, который с календарным
  // месяцем не совпадает: начнись он первого числа — «сентябрь» был бы
  // правдой, и подмену стало бы нечем поймать.
  expect(
    current!.starts_on.slice(8, 10),
    'период посеян так, чтобы не начинаться первым числом',
  ).not.toBe('01');

  await signIn(context, 'manager');
  await openBilling(page, world().historyProjectId);

  await expect(periodLine(page)).toContainText(title(current!));

  // И в выпадашке то же самое: список периодов — это даты и состояние,
  // а не двенадцать названий месяцев, про которые никто не знает, есть
  // ли там хоть что-нибудь.
  const options = page.locator('.period-pick option');
  await expect(options).toHaveCount(periods.length);
  for (const p of periods) {
    await expect(options.filter({ hasText: `Период ${p.seq}` })).toContainText(title(p));
  }
});

test('«предварительно» и «приблизительно» — разные пометки и стоят не вместе', async ({
  context,
  page,
}) => {
  const periods = await periodsOf(world().historyProjectId);
  const open = periods.find((p) => p.status === 'open')!;
  const locked = periods.find((p) => p.status === 'locked' && p.snapshot_approx);
  expect(locked, 'мир обязан приготовить подытоженный период с приблизительным срезом').toBeTruthy();

  await signIn(context, 'manager');
  await openBilling(page, world().historyProjectId);

  // Идущий период: числа ещё изменятся — «подожди». Про приблизительность
  // говорить нечего: поденная статистика за него на месте.
  await expect(periodLine(page)).toContainText('Предварительно');
  await expect(periodLine(page)).not.toContainText('Данные приблизительные');
  await expect(page.getByText(`Период идёт до ${day(open.ends_on)}`)).toBeVisible();

  await page.locator('.period-pick select').selectOption(String(locked!.seq));
  await expect(page).toHaveURL(new RegExp(`period=${locked!.seq}`));
  await expect(periodLine(page)).toContainText(title(locked!));

  // Подытоженный период: числа больше не изменятся, и «предварительно»
  // про них — неправда. Зато мерить их было нечем, и это другое действие:
  // не ждать, а перепроверить.
  await expect(periodLine(page)).toContainText('Данные приблизительные');
  await expect(periodLine(page)).not.toContainText('Предварительно');

  // «За период» не отвечает на вопрос, когда эти просмотры мерили, —
  // между концом периода и срезом проходит две недели.
  await expect(periodLine(page)).toContainText(
    `по состоянию на ${day(locked!.snapshot_as_of ?? '')}`,
  );
  await expect(page.getByText(/Поденной статистики за этот период уже нет/)).toBeVisible();
});

test('заказчик видит ту же оговорку на счёте за прошлый период', async ({ context, page }) => {
  const periods = await periodsOf(world().historyProjectId);
  const locked = periods.find((p) => p.status === 'locked' && p.snapshot_approx)!;

  await signIn(context, 'client');
  await page.goto(`/me/projects/${world().historyProjectId}`);

  // Счёт за прошлый период — отдельная плашка: наверху стоит текущий, а
  // он ещё идёт, и платить по нему нечего.
  const due = page.locator('.duebar');
  await expect(due, 'подытоженный прошлый период — это счёт').toBeVisible({ timeout: 15_000 });
  await expect(due).toContainText(title(locked));

  // Оговорка та же и сказана словами, а не оттенком плашки: заказчик
  // сверяет этот счёт со своими ожиданиями, и «данные приблизительные»
  // для него — повод спросить, а не повод ждать.
  await expect(due).toContainText('Данные приблизительные');
  await expect(due).toContainText(`${day(locked.starts_on)} — ${day(locked.ends_on)}`);
});
