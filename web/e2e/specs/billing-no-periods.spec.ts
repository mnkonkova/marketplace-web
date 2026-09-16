import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab } from '../fixtures/ui';

/**
 * Проект, в котором не вышло ни одного ролика.
 *
 * Отсчёт периодов начинается с первой публикации, и пока её нет, считать
 * не от чего. Это состояние, а не сбой — но собрано оно из двух разных
 * ответов: денежная ручка отвечает отказом `no_periods`, а список
 * периодов — обычным пустым списком. Страница дёргает обе, и пока их
 * читают порознь, она умудряется показать пустое состояние И красный
 * тост одновременно: объяснение, почему чисел нет, и рядом сообщение,
 * что «что-то пошло не так».
 *
 * Поэтому смотрим оба ответа за один заход и проверяем ровно то, что
 * увидит человек: объяснение есть, ошибки нет, нулей нет. Ноль здесь
 * читался бы как «посчитали, и вышло ноль», — а не считали вовсе.
 */
const signIn = (context: import('@playwright/test').BrowserContext, role: 'manager' | 'client') =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );

/** Красный тост ng-zorro — то, чего на этом экране быть не должно. */
const toasts = (page: Page) => page.locator('.ant-message-notice');

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
  box = await createSandbox('noper', { shape: 'empty' });
});

test.afterAll(() => dropSandbox(box));

test('у проекта без публикаций период не начался, и это сказано словами', async ({
  context,
  page,
}) => {
  await signIn(context, 'manager');

  // Обе ручки ловим за один заход: порознь каждая ведёт себя правильно,
  // а вместе дают экран с объяснением и ошибкой сразу.
  const answers: Record<string, number> = {};
  page.on('response', (res) => {
    const path = new URL(res.url()).pathname;
    if (/^\/api\/v1\/manager\/projects\/[^/]+\/billing$/.test(path))
      answers['billing'] = res.status();
    if (path.endsWith('/billing/periods')) answers['periods'] = res.status();
  });

  await page.goto(`/manager/projects/${box.projectId}`);
  // Именно вкладка: над ней в предупреждении о предоплате стоит
  // «Открыть начисления», и поиск по кнопке находил обе.
  await page.getByRole('tab', { name: 'Начисления' }).click();

  const empty = page.getByText(/Период начнётся с первого вышедшего ролика/);
  await expect(empty, 'вместо чисел — объяснение, почему их нет').toBeVisible({ timeout: 15_000 });

  expect(answers['billing'], 'денежная ручка отвечает отказом «периодов нет»').toBe(404);
  expect(answers['periods'], 'список периодов отвечает пустым списком, а не отказом').toBe(200);

  // Отказ по делу — не повод пугать человека: «нечего считать» это
  // состояние проекта, а не поломка.
  await expect(toasts(page)).toHaveCount(0);

  // И нулей нет: ни «К оплате 0 ₽», ни пустых плиток. Ноль — это ответ
  // на вопрос, который никто не задавал.
  await expect(page.getByText('Итого к выплате')).toHaveCount(0);
  await expect(page.locator('.bill .kpis')).toHaveCount(0);

  // Пересчитывать тоже нечего: кнопка обещала бы действие, которого нет.
  await expect(page.getByRole('button', { name: 'Пересчитать' })).toHaveCount(0);
});

/**
 * Вкладка «Деньги» у заказчика на проекте без публикаций.
 *
 * Обещание то же, что у менеджера: считать пока не от чего, и это
 * СОСТОЯНИЕ, а не сбой — значит оно должно быть названо словами.
 * Соседние вкладки так и делают: «Роликов пока нет», «Выкладок в
 * проекте пока нет», «Команда появится, когда начнётся период».
 *
 * Требуем объяснение где угодно в карточке, а не конкретную фразу на
 * конкретной вкладке: куда его поставить — решать продукту, а вот
 * пустое место читается как потерянные данные, и это уже не решение, а
 * поломка.
 */
test('заказчик на таком проекте видит объяснение, а не пустое место', async ({ context, page }) => {
  await signIn(context, 'client');
  await page.goto(`/me/projects/${box.projectId}`);
  await openClientTab(page, 'Деньги');

  // Красный тост — не повод пугать человека: «нечего считать» это
  // состояние проекта, а не поломка.
  await expect(toasts(page)).toHaveCount(0);
  // Счёта нет — ни за текущий период, ни за прошлый: платить пока не за что.
  await expect(page.locator('.billbar')).toHaveCount(0);
  await expect(page.locator('.duebar')).toHaveCount(0);

  // А вот объяснение — есть. Проверяем не фразу, а факт: на вкладке
  // «Деньги» стоит хоть что-то, из чего человеку понятно, почему чисел
  // нет. Сейчас там пусто совсем.
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const explained =
    /Период начнётся|начнётся с первого|пока ничего не опубликовано|считать пока не от чего|появится, когда начнётся период/i.test(
      body,
    );
  expect(
    explained,
    'на вкладке «Деньги» у проекта без публикаций не сказано ничего: ' +
      'ни счёта, ни объяснения, почему его нет. Пустое место читается как ' +
      'потерянные данные — соседние вкладки в этом же экране объясняют пустоту словами',
  ).toBe(true);
});
