import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, request as pwRequest } from '@playwright/test';
import { AUTH_KEY, psql, resetRateLimits } from '../fixtures/world';
import { createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';
import { openClientTab } from '../fixtures/ui';

/**
 * Вход из мини-аппа Telegram и подключение бота из кабинета.
 *
 * Проверяем цепочку, у которой нет ни одного промежуточного экрана,
 * где поломка была бы видна: человек открывает мини-апп, мы проверяем
 * подпись, заводим или узнаём аккаунт и уводим в кабинет. Сломается
 * любое звено — человек увидит «не получилось войти» и не узнает,
 * почему.
 *
 * Подпись собираем ТЕМ ЖЕ способом, что Telegram, и тем же токеном,
 * что стоит на стенде: иначе тест проверял бы наш код своей же
 * копией алгоритма и был бы зелёным при сломанной проверке.
 */
/**
 * Токен берём ТОТ ЖЕ, на котором работает стенд, — иначе подпись не
 * сойдётся и специя покажет «вход сломан» там, где сломана она сама.
 *
 * Читаем его из .env бэкенда, а не держим в репозитории: это
 * настоящий токен настоящего бота, и место ему там, где .gitignore.
 * Нет файла или строки — специи, которым нужна верная подпись,
 * пропускаются с внятным сообщением, а не падают.
 */
function standBotToken(): string {
  if (process.env.E2E_TG_BOT_TOKEN) return process.env.E2E_TG_BOT_TOKEN;
  const envPath =
    process.env.E2E_API_ENV ?? join(__dirname, '..', '..', '..', '..', 'marketplace-api', '.env');
  try {
    const line = readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('TELEGRAM_CREATOR_BOT_TOKEN='));
    return (line ?? '').slice('TELEGRAM_CREATOR_BOT_TOKEN='.length).trim();
  } catch {
    return '';
  }
}

const BOT_TOKEN = standBotToken();
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

/** initData ровно в том виде, в каком его отдаёт Telegram. */
function signInitData(tgUserID: number, username: string, authDate = new Date()): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(authDate.getTime() / 1000)),
    user: JSON.stringify({
      id: tgUserID,
      first_name: 'Лев',
      last_name: 'Северов',
      username,
    }),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', key).update(check).digest('hex');
  const q = new URLSearchParams(fields);
  q.set('hash', hash);
  return q.toString();
}

/** Свой телеграм на каждый прогон: аккаунт заводится настоящий. */
const tgUserID = 900_000_000 + (Date.now() % 90_000_000);

/**
 * Знакомый телеграм: человек уже зарегистрирован и привязан.
 *
 * Заводим SQL-ем, а не через мини-апп: регистрации там больше нет —
 * анкета заполняется на сайте. Проверять на этом человеке надо
 * другое: что знакомый телеграм пускают сразу и ведут туда, куда
 * звала кнопка из сообщения.
 */
test.beforeAll(() => {
  psql(`
INSERT INTO users (email, password_hash, kind, is_approved, is_active, email_verified_at,
                   display_name, telegram_user_id)
VALUES ('tg-known-${tgUserID}@example.com', 'x', 'specialist', TRUE, TRUE, now(),
        'Знакомый телеграм', ${tgUserID})
ON CONFLICT (email) DO NOTHING;

INSERT INTO specialist_profiles (user_id, display_name)
SELECT id, 'Знакомый телеграм' FROM users WHERE telegram_user_id = ${tgUserID}
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_identities (provider, provider_id, user_id)
SELECT 'telegram', '${tgUserID}', id FROM users WHERE telegram_user_id = ${tgUserID}
ON CONFLICT DO NOTHING;

INSERT INTO telegram_links (user_id, bot, tg_user_id, tg_chat_id, tg_username)
SELECT id, 'creator', ${tgUserID}, ${tgUserID}, 'lev'
FROM users WHERE telegram_user_id = ${tgUserID}
ON CONFLICT DO NOTHING;`);
});

test.afterAll(() => {
  // Человек, заведённый этой спекой, живёт без почты — найти его можно
  // только по телеграму.
  psql(`DELETE FROM users WHERE telegram_user_id = ${tgUserID};`);
});

// Вход считается по тому же лимиту, что и обычный: десять попыток в
// минуту с адреса. Специй здесь полтора десятка, и они укладываются в
// минуту втроём — хвост ловил 429 и падал «элемент не найден», хотя
// сломан был только счётчик.
test.beforeEach(() => resetRateLimits());

test('вне Telegram страница входа объясняет, что это другой вход', async ({ page }) => {
  await page.goto('/tg');
  await expect(page.getByRole('heading', { name: 'Это вход из Telegram' })).toBeVisible({
    timeout: 15_000,
  });
  // И ведёт туда, где вход есть, а не оставляет в тупике.
  await expect(page.getByRole('link', { name: 'Войти на сайте' })).toBeVisible();
});

test('незнакомый телеграм спрашивает, новый человек или нет', async ({ page }) => {
  test.skip(!BOT_TOKEN, 'TELEGRAM_CREATOR_BOT_TOKEN стенда не найден — подпись не собрать');
  await page.goto(
    `/tg/creator?dev_init_data=${encodeURIComponent(signInitData(tgUserID + 20, 'nobody'))}`,
  );

  // Молча второй аккаунт не заводим: у человека уже может быть наш — с
  // проектами и историей.
  await expect(page.getByRole('heading', { name: 'Первый раз здесь?' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'У меня есть аккаунт' })).toBeVisible();
});

test('на экране входа видно каждую кнопку и каждую подпись', async ({ page }) => {
  test.skip(!BOT_TOKEN, 'TELEGRAM_CREATOR_BOT_TOKEN стенда не найден — подпись не собрать');
  await page.goto(
    `/tg/creator?dev_init_data=${encodeURIComponent(signInitData(tgUserID + 21, 'nobody2'))}`,
  );
  await expect(page.getByRole('heading', { name: 'Первый раз здесь?' })).toBeVisible({
    timeout: 20_000,
  });

  // Тот самый промах: у второй кнопки цвет текста был «как у
  // родителя», а родитель внутри Telegram красится ЕГО темой — и
  // надпись пропадала на тёмном фоне. Проверяем не «класс на месте»,
  // а видно ли текст: цвет буквы не совпадает с цветом подложки.
  const contrast = async (locator: import('@playwright/test').Locator) =>
    locator.evaluate((el) => {
      const own = getComputedStyle(el);
      let bg = own.backgroundColor;
      let node: HTMLElement | null = el;
      // Прозрачную подложку ищем у предков: на кнопке её может не
      // быть вовсе.
      while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        node = node.parentElement;
        bg = node ? getComputedStyle(node).backgroundColor : 'rgb(255, 255, 255)';
      }
      return { color: own.color, bg };
    });

  for (const name of ['Я здесь впервые', 'У меня есть аккаунт']) {
    const { color, bg } = await contrast(page.getByRole('button', { name }));
    expect(color, `${name}: текст сливается с подложкой`).not.toBe(bg);
  }

  // И на втором шаге — подписи полей: они тоже красились «как
  // родитель» и были невидимы.
  await page.getByRole('button', { name: 'У меня есть аккаунт' }).click();
  await expect(page.getByText('Почта или телефон')).toBeVisible();
  await expect(page.getByText('Пароль', { exact: true })).toBeVisible();
  const back = await contrast(page.getByRole('button', { name: 'Назад' }));
  expect(back.color, 'кнопка «Назад»: текст сливается с подложкой').not.toBe(back.bg);
});

test('тому, кто входит через Яндекс, объясняют путь вместо пароля', async ({ page }) => {
  test.skip(!BOT_TOKEN, 'TELEGRAM_CREATOR_BOT_TOKEN стенда не найден — подпись не собрать');
  await page.goto(
    `/tg/creator?dev_init_data=${encodeURIComponent(signInitData(tgUserID + 22, 'nobody3'))}`,
  );
  await page.getByRole('button', { name: 'У меня есть аккаунт' }).click();

  // У аккаунта, заведённого через Яндекс, пароля нет вовсе: экран
  // спросил бы его и не принял ничего, а человек решил бы, что
  // сломались мы. Поэтому подсказка стоит ДО ввода.
  await page.getByRole('button', { name: /Пароля у вас нет/ }).click();
  await expect(page.getByRole('heading', { name: 'Вы входите через Яндекс' })).toBeVisible();
  await expect(page.getByText('Получать уведомления в Telegram')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть сайт в браузере' })).toBeVisible();

  // И назад к развилке — тупика здесь быть не должно.
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByRole('heading', { name: 'Первый раз здесь?' })).toBeVisible();
});

test('«я здесь впервые» уводит в анкету на сайте и привязывает телеграм после регистрации', async ({
  page,
  context,
}) => {
  test.skip(!BOT_TOKEN, 'TELEGRAM_CREATOR_BOT_TOKEN стенда не найден — подпись не собрать');
  const fresh = tgUserID + 11;
  await page.goto(`/tg/creator?dev_init_data=${encodeURIComponent(signInitData(fresh, 'new'))}`);
  await expect(page.getByRole('heading', { name: 'Первый раз здесь?' })).toBeVisible({
    timeout: 20_000,
  });

  // Регистрации в мини-аппе нет намеренно: анкета с категориями и
  // портфолио заполняется на сайте, а «я новый» нажимали и те, у кого
  // аккаунт давно есть, — телеграм привязывался к пустому дублю.
  await page.evaluate(() => {
    const urls: string[] = [];
    (window as unknown as { __opened: string[] }).__opened = urls;
    (window as unknown as { open: (u?: string | URL) => null }).open = (u) => {
      urls.push(String(u));
      return null;
    };
  });
  const [ticket] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/auth/telegram/link-ticket') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Я здесь впервые' }).click(),
  ]);
  expect(ticket.status(), await ticket.text()).toBe(200);
  const code = (await ticket.json()).code as string;

  const urls: string[] = await page.evaluate(
    () => (window as unknown as { __opened: string[] }).__opened ?? [],
  );
  expect(urls.join(' '), 'ведём сразу в анкету, а не на главную').toContain(
    '/start?role=specialist',
  );
  expect(urls.join(' '), 'билет едет вместе с адресом').toContain(`tg=${encodeURIComponent(code)}`);

  // Аккаунта всё ещё нет: билет сам по себе ничего не привязывает.
  const api = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: {
      Authorization: `Bearer ${process.env.E2E_BOT_SECRET ?? 'stand-bot-shared-secret'}`,
    },
  });
  expect((await api.get(`/api/v1/bot/users/by-telegram/${fresh}?bot=creator`)).status()).toBe(404);

  // А вот человек зарегистрировался в браузере — и телеграм
  // привязался сам, без возврата в бот.
  const browser = await context.newPage();
  await browser.goto(`/start?role=specialist&tg=${encodeURIComponent(code)}`);
  const email = `tg-ticket-${Date.now()}@example.com`;
  const claimed = browser.waitForResponse(
    (r) => r.url().includes('/me/telegram/claim') && r.request().method() === 'POST',
  );
  await browser.evaluate(
    async ([mail, base]) => {
      // Регистрируем тем же запросом, что и форма: проверяем привязку,
      // а не мастер профиля — у него свои специи.
      const res = await fetch(`${base}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: mail,
          password: 'PrMarket!2026-tg',
          kind: 'specialist',
          display_name: 'Из телеграма',
        }),
      });
      const body = await res.json();
      const store = {
        access_token: body.tokens.access_token,
        refresh_token: body.tokens.refresh_token,
        kind: 'specialist',
      };
      localStorage.setItem('marketpclce.auth.v1', JSON.stringify(store));
      // Тот же путь, которым это делает приложение: билет лежит в
      // sessionStorage, гасится сразу после появления сессии.
      await fetch(`${base}/me/telegram/claim`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${body.tokens.access_token}`,
        },
        body: JSON.stringify({ code: sessionStorage.getItem('prmarket.tg.claim') }),
      });
    },
    [email, `${API}/api/v1`] as const,
  );
  await claimed.catch(() => undefined);

  const who = await api.get(`/api/v1/bot/users/by-telegram/${fresh}?bot=creator`);
  expect(who.status(), 'телеграм привязался к свежему аккаунту сам').toBe(200);
  await api.dispose();
  psql(`DELETE FROM users WHERE email = '${email}';`);
});

test('кнопка из сообщения приводит на нужный экран, а чужой адрес — нет', async ({ page }) => {
  test.skip(!BOT_TOKEN, 'TELEGRAM_CREATOR_BOT_TOKEN стенда не найден — подпись не собрать');
  const init = encodeURIComponent(signInitData(tgUserID, 'lev'));

  // Так выглядит переход по кнопке «Открыть» из сообщения бота:
  // сессии в мини-аппе ещё нет, её выдаёт /tg, а `to` говорит, куда
  // идти дальше. Приводить человека на список проектов после кнопки
  // «ваш ролик приняли» значит заставить его искать то, о чём ему
  // только что написали.
  await page.goto(`/tg/creator?dev_init_data=${init}&to=%2Fme%2Fcreator%2Finvitations`);
  await expect(page).toHaveURL(/\/me\/creator\/invitations/, { timeout: 20_000 });

  // А чужой адрес игнорируется молча: человек попадает в свой
  // кабинет, а не туда, куда его звала ссылка.
  await page.goto(`/tg/creator?dev_init_data=${init}&to=https%3A%2F%2Fevil.example%2Fme`);
  await expect(page).toHaveURL(/\/me\/creator\/projects/, { timeout: 20_000 });
});

test('подпись из фрагмента адреса не теряется по дороге', async ({ page }) => {
  test.skip(!BOT_TOKEN, 'TELEGRAM_CREATOR_BOT_TOKEN стенда не найден — подпись не собрать');

  // Так это приходит на живом телефоне: Telegram кладёт подпись во
  // ФРАГМЕНТ адреса, а не в query. Роутер Angular переписывает адрес
  // на первой же навигации и перекодирует фрагмент — и скрипт
  // Telegram, загруженный асинхронно, читает уже испорченную строку:
  // подпись не сходится, user приезжает в процентах и не разбирается
  // как JSON. Человек видит «данные не разобрались», не сделав
  // ничего.
  const init = signInitData(tgUserID + 5, 'frag');
  await page.goto(`/tg/creator#tgWebAppData=${encodeURIComponent(init)}`);

  // Развилка — значит строка доехала целой и подпись сошлась:
  // «этого телеграма мы не знаем» это ответ сервера, а не разбор.
  await expect(page.getByRole('heading', { name: 'Первый раз здесь?' })).toBeVisible({
    timeout: 20_000,
  });
});

test('подпись во фрагменте без кодирования — тоже не теряется', async ({ page }) => {
  test.skip(!BOT_TOKEN, 'TELEGRAM_CREATOR_BOT_TOKEN стенда не найден — подпись не собрать');

  // Так это приходит на части клиентов: подпись лежит во фрагменте
  // КАК ЕСТЬ, с обычными «&» внутри, а следом идут собственные
  // параметры Telegram. Обрезка по первому «&» оставляла от неё один
  // query_id — сервер честно отвечал «нет hash», и человек упирался в
  // «данные не разобрались», не сделав ничего.
  const init = signInitData(tgUserID + 6, 'raw');
  await page.goto(`/tg/creator#tgWebAppData=${init}&tgWebAppVersion=7.0&tgWebAppPlatform=android`);

  await expect(page.getByRole('heading', { name: 'Первый раз здесь?' })).toBeVisible({
    timeout: 20_000,
  });
});

test('подделанная подпись не пускает', async ({ page }) => {
  const fake = signInitData(tgUserID + 1, 'lev').replace(
    /hash=[0-9a-f]+/,
    'hash=' + 'a'.repeat(64),
  );
  await page.goto(`/tg/creator?dev_init_data=${encodeURIComponent(fake)}`);
  await expect(page.getByRole('heading', { name: 'Не получилось войти' })).toBeVisible({
    timeout: 20_000,
  });
});

test('ручки бота закрыты общим секретом', async () => {
  const api = await pwRequest.newContext({ baseURL: API });
  // Без секрета — 401, а не «не найдено»: ручка есть, и скрывать это
  // незачем; пускать по адресу — есть зачем.
  const bare = await api.post('/api/v1/bot/link', {
    data: { bot: 'creator', code: 'nope', tg_user_id: 1, tg_chat_id: 1 },
  });
  expect(bare.status()).toBe(401);

  // С секретом ручка работает и честно говорит, что кода нет.
  const withSecret = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: {
      Authorization: `Bearer ${process.env.E2E_BOT_SECRET ?? 'stand-bot-shared-secret'}`,
    },
  });
  const unknown = await withSecret.post('/api/v1/bot/link', {
    data: { bot: 'creator', code: 'definitely-not-a-code', tg_user_id: 1, tg_chat_id: 1 },
  });
  expect(unknown.status(), await unknown.text()).toBe(404);
  await api.dispose();
  await withSecret.dispose();
});

/**
 * Кабинет внутри мини-аппа.
 *
 * Это не отдельный экран, а те же кабинеты — и разница видна только
 * тем, что внутри Telegram у них нет нашей шапки (сверху уже есть
 * шапка бота, и вторая под ней читается как чужая страница) и нет
 * кнопки «подключить бота» (человек уже в Telegram).
 *
 * Проверяем именно это: признак мини-аппа доезжает до КАЖДОГО экрана,
 * а не только до страницы входа. Ошибка тут тихая — кабинет выглядит
 * рабочим, просто чужим.
 */
test.describe('кабинет внутри мини-аппа', () => {
  let box: Sandbox;

  test.beforeAll(async () => {
    box = await createSandbox('tgapp', { shape: 'empty', ownCreator: true, ownClient: true });
  });

  test.afterAll(() => dropSandbox(box));

  test('шапка сайта спрятана, кнопка подключения не предлагается', async ({ context, page }) => {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.creator] as const,
    );
    // dev_init_data — подстановка для стенда: настоящий Telegram
    // локальный адрес не откроет, а проверять экран как-то надо.
    await page.goto(
      `/me/creator/projects/${box.projectId}?dev_init_data=${encodeURIComponent('user=%7B%22id%22%3A1%7D&hash=z')}`,
    );

    await expect(page.locator('body.tg-app')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('app-header')).toBeHidden();
    // Кнопки подключения внутри Telegram нет вовсе: привязка случилась
    // на входе, и предлагать её второй раз незачем.
    await expect(page.getByRole('button', { name: 'Получать уведомления в Telegram' })).toHaveCount(
      0,
    );
  });

  test('менеджер открывает свои проекты и не теряет навигацию', async ({ context, page }) => {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.manager] as const,
    );
    await page.goto(
      `/manager/projects?dev_init_data=${encodeURIComponent('user=%7B%22id%22%3A1%7D&hash=z')}`,
    );

    // Мини-апп опознан — вибрация и «назад» работают.
    await expect(page.locator('body.tg-app')).toHaveCount(1, { timeout: 20_000 });
    // И навигация не потерялась: у менеджерских экранов своя оболочка
    // CRM, шапка сайта в ней не участвует вовсе.
    await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('в обычном браузере тот же экран с шапкой', async ({ context, page }) => {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.creator] as const,
    );
    await page.goto(`/me/creator/projects/${box.projectId}`);
    await expect(page.locator('app-header')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body.tg-app')).toHaveCount(0);
  });
});

/**
 * Кнопка подключения бота живёт в карточке проекта — и это решение, а
 * не случайность: баннер просят закрыть, рассылку «подключите бота»
 * не делаем вовсе, а здесь человек уже смотрит на работу, по которой
 * уведомления и придут.
 */
test.describe('кнопка подключения в проекте', () => {
  let box: Sandbox;

  test.beforeAll(async () => {
    box = await createSandbox('tglink', { shape: 'empty', ownCreator: true, ownClient: true });
  });

  test.afterAll(() => {
    psql(`DELETE FROM telegram_link_codes WHERE user_id = '${box.creator.userId}';`);
    dropSandbox(box);
  });

  test('креатор получает одноразовую ссылку прямо из проекта', async ({ context, page }) => {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.creator] as const,
    );
    // Окно Telegram открывать некуда: перехватываем, иначе всплывашка
    // уведёт браузер со страницы посреди проверки.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto(`/me/creator/projects/${box.projectId}`);

    const button = page.getByRole('button', { name: 'Получать уведомления в Telegram' });
    await expect(button).toBeVisible({ timeout: 20_000 });

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/me/telegram/link-code') && r.request().method() === 'POST',
      ),
      button.click(),
    ]);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    // Ссылка ведёт в нашего бота и несёт код: руками его никто не
    // вводит, и показывать его отдельно незачем.
    expect(String(body.url)).toMatch(/^https:\/\/t\.me\/[\w_]+\?start=.+/);

    // На экране — та же ссылка и QR для тех, кто с десктопа.
    await expect(page.getByRole('link', { name: 'Открыть Telegram' })).toBeVisible();
    await expect(page.locator('canvas.qr')).toBeVisible();
  });

  test('заказчик подключает своего бота рядом с выключателями', async ({ context, page }) => {
    await context.addInitScript(
      ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
      [AUTH_KEY, box.sessions.client] as const,
    );
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto(`/me/projects/${box.projectId}`);
    await openClientTab(page, 'Доступы');

    // Кнопка стоит в том же блоке, что галочки «о чём писать»: без неё
    // человек ставит галочки, ничего не получает и решает, что
    // уведомления сломаны.
    const panel = page.locator('.panel', { hasText: 'Уведомления в Telegram' });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(
      panel.getByRole('button', { name: 'Получать уведомления в Telegram' }),
    ).toBeVisible();
  });
});
