import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { call, createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/**
 * Материалы проекта: бриф креаторам и результат заказчику.
 *
 * Аудитория здесь — не оформление, а право видеть: обучение и бренд-гайд
 * для команды заказчику не показывают, а приложенный результат работы —
 * наоборот, его и есть смысл показать. Ошибиться в этой развилке можно
 * молча: материал ляжет в базу, менеджер увидит его у себя в списке и
 * будет уверен, что адресат его читает.
 *
 * Именно так и было. Условие «кому сказать о новом материале» сравнивало
 * аудиторию со строками `creator` и `all`, а легальные значения —
 * `creators` и `client` (CHECK в migrations/00036_materials_autoping.sql).
 * Условие не выполнялось НИ РАЗУ: уведомление «задание изменилось» не
 * уходило, а счётчик материалов в самом задании приезжал нулём при полном
 * проекте материалов. Отправку стережёт integration-тест
 * (TestMaterialForCreatorsNotifiesThem), здесь — видимая часть: доезжает
 * ли материал до того, кому предназначен, и не доезжает ли до чужих глаз.
 */
let box: Sandbox;

/** Названия материалов делаем уникальными: специи идут по общему стенду. */
const stamp = String(Date.now()).slice(-6);
const forCrew = `Бренд-гайд ${stamp}`;
const forClient = `Готовый ролик ${stamp}`;

test.beforeAll(async () => {
  box = await createSandbox(`mats${stamp}`, { ownCreator: true, ownClient: true });

  // Кладём теми же запросами, что шлёт интерфейс менеджера.
  await call(box, 'manager', 'post', `/api/v1/manager/projects/${box.projectId}/materials`, {
    kind: 'doc',
    title: forCrew,
    url: 'https://cdn.example.com/brand-guide.pdf',
    audience: 'creators',
  });
  await call(box, 'manager', 'post', `/api/v1/manager/projects/${box.projectId}/materials`, {
    kind: 'link',
    title: forClient,
    url: 'https://disk.example.com/final.mp4',
    audience: 'client',
  });
});

test.afterAll(() => dropSandbox(box));

/** Войти нужным человеком: у песочницы свои люди, а не общие. */
async function signIn(
  context: import('@playwright/test').BrowserContext,
  role: 'manager' | 'creator' | 'client',
): Promise<void> {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );
}

test('креатор видит бриф команды и не видит того, что приложено заказчику', async ({
  context,
  page,
}) => {
  await signIn(context, 'creator');
  await page.goto(`/me/creator/projects/${box.projectId}`);

  // Разметка у кабинета креатора своя: материалы стоят чипами под
  // заданием, рядом с чек-листом, — это и есть «что мне прислали».
  const task = page.locator('.chips').filter({ hasText: forCrew });
  await expect(task, 'материалы задания нарисованы').toBeVisible({ timeout: 15_000 });

  const link = task.getByRole('link', { name: forCrew });
  await expect(link).toHaveAttribute('href', 'https://cdn.example.com/brand-guide.pdf');
  await expect(link).toHaveAttribute('target', '_blank');

  // Чужая аудитория — это не «лишняя строка», а показанный не тому
  // результат работы по проекту.
  await expect(page.locator('body')).not.toContainText(forClient);
});

test('заказчику отдаётся только приложенное ему', async () => {
  // Проверяем НА СЕРВЕРЕ, а не на экране: в кабинете заказчика «под
  // ключ» блока материалов нет вовсе, и зелёная проверка разметки
  // означала бы «ничего не показано», а не «показано правильно».
  // Гарантия здесь серверная: ручка заказчика обязана отдавать только
  // его аудиторию — иначе обучение команды уедет в браузер клиента, и
  // видно это будет во вкладке «Сеть», а не на странице.
  const mine = await call(box, 'client', 'get', `/api/v1/me/projects/${box.projectId}/materials`);
  const titles = ((mine.items ?? []) as { title: string }[]).map((m) => m.title);
  expect(titles, 'заказчику отдали приложенное ему').toContain(forClient);
  expect(titles, 'обучение команды заказчику не отдаём').not.toContain(forCrew);

  // И симметрично: ручка креатора не отдаёт клиентское.
  const crew = await call(
    box,
    'creator',
    'get',
    `/api/v1/me/creator/projects/${box.projectId}/materials`,
  );
  const crewTitles = ((crew.items ?? []) as { title: string }[]).map((m) => m.title);
  expect(crewTitles).toContain(forCrew);
  expect(crewTitles).not.toContain(forClient);
});

test('у менеджера оба списка порознь, и подписаны они аудиторией', async ({ context, page }) => {
  await signIn(context, 'manager');
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Материалы');

  const mats = page.locator('.mat-block').first();
  await expect(mats).toBeVisible({ timeout: 15_000 });

  // Два списка, а не один общий: менеджер кладёт материал ОСОЗНАННО
  // кому-то, и общий список превращает выбор аудитории в лотерею.
  const groups = mats.locator('.group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText(forCrew);
  await expect(groups.nth(0)).not.toContainText(forClient);
  await expect(groups.nth(1)).toContainText(forClient);
  await expect(groups.nth(1)).not.toContainText(forCrew);
});
