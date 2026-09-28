import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY, world } from '../fixtures/world';

/**
 * «Создать проект» на узком экране: шторка, а не окно.
 *
 * Жалоба звучала как «форма скачет от клавиатуры», и под ней лежали
 * три разные поломки.
 *
 *  1. Способ показа выбирался по УСТРОЙСТВУ ВВОДА (hover/pointer), а не
 *     по месту на экране. Узкое окно настольного браузера тачем не
 *     считается — и окно шириной 520 px открывалось в экране 390 px.
 *  2. Шторка прибита к низу СТРАНИЦЫ, а клавиатура страницу не
 *     двигает: она уменьшает видимую область и накрывает низ. Браузер
 *     подкручивал страницу к полю сам, каждый раз по-своему, — это и
 *     есть «скачет».
 *  3. Тело шторки не прокручивалось: форма в 936 px растягивала его
 *     целиком внутри шторки на 500, и кнопка «Создать» оказывалась за
 *     краем экрана. Добраться до неё было нечем — страница под шторкой
 *     не прокручивается. Отсюда и прежнее «создать проект с тача
 *     вообще не получается».
 *
 * Клавиатуру в браузере не вызвать, поэтому её имитируем ровно так же,
 * как её видит приложение: переменной --kb-inset, которую заполняет
 * shared/lib/keyboard-inset.ts из visualViewport.
 */
const PHONE = { width: 390, height: 844 };
const KEYBOARD_PX = 320;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, world().sessions.admin] as const,
  );
});

/** Поднять «клавиатуру»: то же, что делает трекер на живом устройстве. */
async function raiseKeyboard(page: Page, px = KEYBOARD_PX): Promise<void> {
  await page.evaluate((h) => {
    document.documentElement.style.setProperty('--kb-inset', `${h}px`);
    document.documentElement.classList.add('kb-up');
  }, px);
  // Подъём анимирован: ждём, пока он закончится, а не «сколько-нибудь».
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const w = document.querySelector('.ant-drawer-bottom .ant-drawer-content-wrapper');
        return w ? Math.round(w.getBoundingClientRect().bottom) : -1;
      }),
    )
    .toBe(PHONE.height - px);
}

test('на узком экране открывается шторкой с заголовком, а не окном по центру', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/admin/projects');
  await page.getByRole('button', { name: 'Создать проект' }).click();

  const sheet = page.locator('.ant-drawer-bottom');
  await expect(sheet, 'форма приехала снизу').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.ant-modal'), 'окна по центру здесь быть не должно').toHaveCount(0);

  // Заголовок и крестик: до этого общее правило прятало шапку у всех
  // нижних шторок разом — ради шторки тегов, у которой шапка своя.
  await expect(sheet.locator('.ant-drawer-header')).toBeVisible();
  await expect(sheet.locator('.ant-drawer-title')).toHaveText('Создать проект');

  // Над шторкой видна полоска фона: так она читается шторкой, и по ней
  // можно закрыть нажатием.
  const top = await sheet
    .locator('.ant-drawer-content-wrapper')
    .evaluate((el) => Math.round(el.getBoundingClientRect().top));
  expect(top, 'шторка не занимает экран целиком').toBeGreaterThan(0);
});

test('форма прокручивается внутри шторки, и кнопка «Создать» достижима', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/admin/projects');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  const sheet = page.locator('.ant-drawer-bottom');
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  const room = await sheet.locator('.ant-drawer-body').evaluate((el) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
    overflow: getComputedStyle(el).overflowY,
  }));
  expect(room.overflow, 'тело шторки прокручивается').toBe('auto');
  expect(room.client, 'и оно ограничено шторкой, а не содержимым').toBeLessThan(room.scroll);

  const submit = sheet.getByRole('button', { name: /Создать|Завести/ }).last();
  await submit.scrollIntoViewIfNeeded();
  await expect(submit, 'до кнопки можно долистать').toBeVisible();
});

test('поднятая клавиатура поднимает шторку, а не сдвигает страницу', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/admin/projects');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  const wrapper = page.locator('.ant-drawer-bottom .ant-drawer-content-wrapper');
  await expect(wrapper).toBeVisible({ timeout: 15_000 });

  const before = await wrapper.evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
  expect(before, 'до клавиатуры шторка стоит на дне экрана').toBe(PHONE.height);

  await raiseKeyboard(page);

  // Нижний край поднялся ровно на высоту клавиатуры — форма целиком над
  // ней, и браузеру нечего подкручивать.
  const after = await wrapper.evaluate((el) => ({
    bottom: Math.round(el.getBoundingClientRect().bottom),
    top: Math.round(el.getBoundingClientRect().top),
  }));
  expect(after.bottom).toBe(PHONE.height - KEYBOARD_PX);
  expect(after.top, 'заголовок остался на экране').toBeGreaterThanOrEqual(0);

  // И кнопка по-прежнему достижима: шторка ужалась, а не обрезалась.
  const submit = page
    .locator('.ant-drawer-bottom')
    .getByRole('button', { name: /Создать|Завести/ })
    .last();
  await submit.scrollIntoViewIfNeeded();
  const box = await submit.boundingBox();
  expect(box, 'кнопка нарисована').not.toBeNull();
  expect(box!.y + box!.height, 'и она над клавиатурой').toBeLessThanOrEqual(
    PHONE.height - KEYBOARD_PX,
  );
});

test('на широком экране остаётся окном по центру', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/projects');
  await page.getByRole('button', { name: 'Создать проект' }).click();

  await expect(page.locator('.ant-modal'), 'окно на месте').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.ant-drawer-bottom'), 'шторки на широком экране нет').toHaveCount(0);
});
