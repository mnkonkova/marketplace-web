import { test, expect } from '@playwright/test';
import { AUTH_KEY, psql } from '../fixtures/world';
import { createSandbox, dayAt, dropSandbox, ymd, type Sandbox } from '../fixtures/sandbox';
import { openCreatorTab } from '../fixtures/ui';

/**
 * Своя выкладка сверх плана: добавили — и страница осталась живой.
 *
 * Проверка ровно про второе. Сам запрос уходил и выкладка в базе
 * заводилась, но ответ на него приходил с `links: null` — поле,
 * объявленное массивом. Страница подставляла ответ в список как есть, и
 * первое же обращение к `links.length` валило отрисовку. Дальше не
 * работало НИЧЕГО: новая выкладка не появлялась, окно «добавить»
 * открывалось без календаря, «показать ссылки» и «сдать ролик» не
 * отзывались на нажатие. Выглядело это как четыре разные поломки, а было
 * одной.
 *
 * Поэтому здесь после добавления проверяется не только новая строка, но и
 * чужие кнопки — и консоль: молчащая ошибка в отрисовке и есть та самая
 * поломка.
 */

/** Через сколько дней ставим свой ролик. Достаточно далеко, чтобы день был свободен. */
const DAYS_AHEAD = 50;

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
  box = await createSandbox('selfadd');
});

test.afterAll(() => dropSandbox(box));

/** Та же дата, как её подписывает календарь: дд.мм.гггг. */
function typed(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Выбрать дату в календаре — мышью, как человек.
 *
 * Не вводом с клавиатуры: поле разбирает набранное по своему формату, и
 * тест на этом проверял бы разборщик дат, а не то, ради чего написан.
 */
async function pickDate(
  page: import('@playwright/test').Page,
  field: import('@playwright/test').Locator,
  when: Date,
): Promise<void> {
  await field.click();
  // Последняя панель: на странице есть второй календарь — в окне
  // переноса даты, — и его слой остаётся в разметке скрытым. Поиск по
  // всем панелям сразу берёт то тот, то другой, и лист «вперёд» уезжает
  // не в том календаре: ячейка нужного дня не появляется никогда, а
  // падение выглядит как «кнопка не нажимается».
  const panel = page.locator('.ant-picker-panel-container').last();
  await expect(panel, 'календарь раскрывается').toBeVisible();
  // Листаем, пока нужный день не окажется в показанном месяце. Считать
  // клики по разнице месяцев нельзя: панель перерисовывается, и клик по
  // ячейке успевает попасть в уже уехавшую сетку.
  const cell = panel.locator(`td.ant-picker-cell-in-view[title="${typed(when)}"]`);
  const header = panel.locator('.ant-picker-header-view');
  // После нажатия «вперёд» ждём, пока подпись месяца сменится. Без этого
  // проверка «нужный день уже виден» читает ещё не перерисованную сетку,
  // цикл пролистывает лишнее, и клик попадает в другую неделю — дата
  // уезжает на месяц, а тест при этом выглядит зелёным.
  for (let i = 0; i < 24 && (await cell.count()) === 0; i += 1) {
    const was = await header.innerText();
    await panel.locator('.ant-picker-header-next-btn').click();
    await expect(header).not.toHaveText(was);
  }
  await cell.click();
  // Выбрали именно то, что нажали: в поле стоит та же дата.
  await expect(field).toHaveValue(typed(when));
}

test('своя выкладка добавляется, и после этого страница жива', async ({ context, page }) => {
  // Тест длинный по делу: окно, календарь с листанием, отправка, потом
  // ещё три чужие кнопки. Тридцати секунд по умолчанию ему не хватает,
  // когда стенд занят соседним прогоном.
  test.setTimeout(120_000);
  const when = dayAt(DAYS_AHEAD);

  // Ошибки отрисовки браузер печатает в консоль и больше нигде: на
  // экране они выглядят как «кнопка не нажимается».
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.creator] as const,
  );

  try {
    await page.goto(`/me/creator/projects/${box.projectId}`);

    // Список выкладок — в своём разделе кабинета.
    await openCreatorTab(page, 'Мои выкладки');
    // Строки выкладок — в «Надо сдать» и в таблице вышедших.
    const slots = page.locator(
      '.posts-stack .row, app-creator-videos table.cv tbody tr:not(.cv-edit)',
    );
    await expect(slots.first()).toBeVisible({ timeout: 15_000 });
    const before = await slots.count();

    // А кнопка добора — в карточке заработка на общей: там стоят числа,
    // ради которых ролик и добирают («осталось 100 тыс. просмотров»,
    // «≈ +4 950 ₽»).
    await openCreatorTab(page, 'Общая');
    const add = page.getByRole('button', { name: 'Взять ещё выкладку' }).first();
    await expect(add, 'период идёт — добрать сверх плана можно').toBeVisible();
    await add.click();

    const modal = page.locator('.modal').filter({ hasText: 'сверх плана' });
    await expect(modal).toBeVisible();

    // Календарь, а не пустая коробка: у поля есть чем набрать дату.
    const date = modal.locator('nz-date-picker input');
    await expect(date, 'в окне есть поле даты').toBeVisible();
    await pickDate(page, date, when);

    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/publications') && r.request().method() === 'POST',
      ),
      modal.getByRole('button', { name: 'Добавить' }).click(),
    ]);
    expect(created.status(), await created.text()).toBe(201);
    // Ушла та дата, которую выбрали в календаре, а не соседняя.
    expect(JSON.parse(created.request().postData() ?? '{}').due_date).toBe(ymd(when));

    // Ответ обязан быть тем, за что себя выдаёт: links объявлены
    // массивом, и null вместо него роняет отрисовку.
    const body = await created.json();
    expect(Array.isArray(body.links), 'links приходят массивом, а не null').toBe(true);

    await expect(modal).toBeHidden();
    // Новая выкладка встала в список — это и было целью нажатия. Раздел
    // выкладок при этом открывается САМ: нажимали на общей, а строка
    // появляется здесь, и без перехода человек смотрел бы на
    // неизменившийся экран со всплывашкой «добавлена».
    await expect(slots).toHaveCount(before + 1);

    // А теперь то, что ломалось заодно. Окно открывается второй раз, и
    // календарь в нём по-прежнему есть.
    await openCreatorTab(page, 'Общая');
    await page.getByRole('button', { name: 'Взять ещё выкладку' }).first().click();
    await expect(modal.locator('nz-date-picker input')).toBeVisible();
    await modal.getByRole('button', { name: 'Отмена' }).click();

    // «Показать ссылки» на любой выкладке — раскрывается. Выкладки
    // снова в своём разделе.
    await openCreatorTab(page, 'Мои выкладки');
    const show = page.getByRole('button', { name: /Показать ссылки|Свернуть/ }).first();
    if (await show.count()) {
      await show.click();
      await expect(page.getByRole('button', { name: 'Свернуть' }).first()).toBeVisible();
    }

    // И окно сдачи открывается.
    const submit = page.locator('.posts-stack').getByRole('button', { name: /^(Сдать|Ссылки)$/ }).first();
    await submit.click();
    await expect(page.locator('.modal').filter({ hasText: 'сдать ролик' })).toBeVisible();

    expect(errors, 'отрисовка не падала').toEqual([]);
  } finally {
    psql(
      `DELETE FROM project_publications WHERE project_id = '${box.projectId}' AND self_added = TRUE AND due_date = '${ymd(when)}';`,
    );
  }
});
