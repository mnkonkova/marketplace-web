import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

// __dirname, а не import.meta: пакет фронта — CommonJS, и ES-модульная
// форма здесь просто не выполнится.
const here = __dirname;

/**
 * Браузерные сквозные тесты.
 *
 * Гоняются по уже поднятому стеку: `make run` в бэкенде и `ng serve` во
 * фронте. Поднимать их самим отсюда — соблазнительно, но тогда падение
 * стека выглядит как падение теста, а разбираться приходится в обоих.
 *
 * Браузер берём тот, что уже скачан для karma (PLAYWRIGHT_BROWSERS_PATH
 * в npm-скрипте), — второй раз качать хромиум незачем.
 */
/**
 * Медленные специи — обходы кнопок.
 *
 * `buttons-sweep` и `buttons-destructive` вдвоём занимают минут
 * двенадцать из четырнадцати: первый обходит каждую кнопку каждой роли,
 * второй жмёт всё, что меняет мир, и ждёт ответов сервера. Остальные
 * сто пятнадцать проходят примерно за минуту.
 *
 * Поэтому набора два. Быстрый (E2E_FAST=1, `npm run e2e:fast`) — перед
 * каждым пушем: он ловит ровно то, из-за чего этот раскол и появился, —
 * разметку кабинета, разошедшуюся со специями. Полный — перед выкаткой
 * и всегда, когда правились кнопки.
 *
 * Делим файлами, а не пометками в названиях: название специи здесь —
 * документация, и дописывать в него «@slow» значит портить её ради
 * запускалки.
 */
const SLOW_SPECS = ['**/buttons-sweep.spec.ts', '**/buttons-destructive.spec.ts'];

export default defineConfig({
  testDir: join(here, 'specs'),
  testIgnore: process.env.E2E_FAST ? SLOW_SPECS : [],
  globalSetup: join(here, 'fixtures', 'world.ts'),
  globalTeardown: join(here, 'fixtures', 'teardown.ts'),
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // Параллель выключена, хотя у каждой специи теперь свой проект.
  // Причина осталась одна, и она не про проекты: специи ходят по общему
  // стенду — общий каталог, общий список админки, общий рейт-лимитер, —
  // и гонка за них даёт мигающие падения, а не находки.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
