import { test, expect, type Page } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { callAs, createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * Обход кабинетов пальцем: что мешает нажать.
 *
 * Отдельно от buttons-sweep, и не ради второй копии. Тот жмёт каждую
 * кнопку и спрашивает «что-нибудь произошло?» — на ДЕСКТОПНОЙ ширине.
 * Здесь ширина телефонная, и вопрос другой: а можно ли до кнопки
 * вообще дотянуться. Обе поломки, из-за которых спека появилась,
 * buttons-sweep проходил зелёным:
 *
 *  • «Сохранить» в кабинете специалиста стояла на x=369..480 при экране
 *    390 — половина кнопки за краем, нажималась случайно. Причина:
 *    инлайновый min-width: 320px у выпадашки рядом;
 *  • зоны нажатия: бургер шапки 36×36 (единственная навигация на
 *    каждом экране), стрелки месяца 38, клетки ленты плана 38×38,
 *    тумблеры автопинга 51×25 — пять подряд, промах переключал
 *    соседнее напоминание.
 *
 * Проверяем три вещи, и каждая — про «дотянуться»: страница не уезжает
 * вбок, ни одна кнопка не выходит за край, у кнопок есть полноценная
 * зона нажатия. Мелкие ссылки внутри юридических текстов сюда
 * намеренно не входят: это проза, а не управление. Футера поддержки в
 * кабинете на телефоне нет вовсе — это решение владельца продукта, а
 * не недосмотр.
 */
const PHONE = { width: 390, height: 844 };

/** Минимальная зона нажатия. Не круглое число из воздуха — палец. */
const TAP = 40;

let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox('tapaudit', { shape: 'stats', ownCreator: true, ownClient: true });
});

test.afterAll(() => dropSandbox(box));

async function signIn(page: Page, session: unknown): Promise<void> {
  await page
    .context()
    .addInitScript(([key, s]) => window.localStorage.setItem(key as string, JSON.stringify(s)), [
      AUTH_KEY,
      session,
    ] as const);
  await page.setViewportSize(PHONE);
}

/** Страница не уезжает вбок и ни одна кнопка не висит за краем. */
async function reachable(page: Page, screen: string): Promise<void> {
  await page.waitForTimeout(700);
  const res = await page.evaluate((tap) => {
    const de = document.documentElement;
    const offscreen: string[] = [];
    const small: string[] = [];
    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      const e = el as HTMLElement;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (!r.width || !r.height || s.visibility === 'hidden') return;
      const label = (e.getAttribute('aria-label') || e.textContent || e.tagName)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 26);
      // Тумблер — исключение, и оно объяснимо. Правило про 40 px
      // написано для КВАДРАТНЫХ целей: иконка, стрелка, клетка. Рельса
      // тумблера после увеличения 66×33 — в неё попадают уверенно, а
      // растягивать её до 40 по высоте значит нарисовать на телефоне
      // переключатель размером с кнопку. Ширину при этом проверяем:
      // узкая рельса исключением не считается.
      if (e.classList.contains('ant-switch') && r.width >= 60 && r.height >= 30) return;
      // Целиком за экраном — это закрытая выехавшая панель (сайдбар
      // CRM), а не поломка: её открывают кнопкой «Разделы». Ловим
      // только то, что торчит наружу ЧАСТЬЮ — такое видно и манит
      // нажать.
      const onScreen = r.right > 0 && r.x < de.clientWidth;
      if (!onScreen) return;
      if (r.x < -2 || r.right > de.clientWidth + 2) {
        offscreen.push(`«${label}» x=${Math.round(r.x)}..${Math.round(r.right)}`);
      } else if (Math.min(r.width, r.height) < tap) {
        small.push(`«${label}» ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    });
    return { scroll: de.scrollWidth, client: de.clientWidth, offscreen, small };
  }, TAP);

  expect(res.scroll, `${screen}: страница не шире экрана`).toBeLessThanOrEqual(res.client);
  expect(res.offscreen, `${screen}: кнопки за краем экрана`).toEqual([]);
  expect(res.small, `${screen}: кнопки мельче ${TAP}px`).toEqual([]);
}

test('кабинет заказчика на телефоне', async ({ page }) => {
  await signIn(page, box.sessions.client);
  await page.goto('/me/projects');
  await reachable(page, 'клиент / список проектов');

  await page.goto(`/me/projects/${box.projectId}`);
  await expect(page.locator('app-client-turnkey-project')).toBeVisible({ timeout: 20_000 });
  for (const t of ['Сводка', 'Ролики', 'Календарь', 'Деньги']) {
    await page.locator('app-prmarket-tabbar button', { hasText: t }).first().click();
    await reachable(page, `клиент / проект › ${t}`);
  }
});

test('кабинет креатора на телефоне', async ({ page }) => {
  await signIn(page, box.creators[0].session);
  await page.goto('/me/creator/projects');
  await reachable(page, 'креатор / мои проекты');

  await page.goto(`/me/creator/projects/${box.projectId}`);
  await expect(page.locator('app-prmarket-tabbar')).toBeVisible({ timeout: 20_000 });
  for (const t of ['Деньги', 'Выкладки', 'Задание']) {
    await page.locator('app-prmarket-tabbar button', { hasText: t }).first().click();
    await reachable(page, `креатор / проект › ${t}`);
  }

  await page.goto('/me/creator/invitations');
  await reachable(page, 'креатор / заявки');

  // Кабинет специалиста: здесь и стояла уехавшая за край «Сохранить».
  await page.goto('/me/specialist');
  await reachable(page, 'креатор / профиль специалиста');
});

test('карточка проекта у менеджера на телефоне', async ({ page }) => {
  await signIn(page, box.sessions.manager);
  await page.goto(`/manager/projects/${box.projectId}`);
  await expect(page.locator('app-prmarket-tabbar')).toBeVisible({ timeout: 20_000 });
  for (const t of ['Горит', 'План', 'Ссылки']) {
    const b = page.locator('app-prmarket-tabbar button', { hasText: t }).first();
    if (!(await b.count())) continue;
    await b.click();
    await reachable(page, `менеджер / проект › ${t}`);
  }
});

/**
 * Подвала на тач-ширине нет — ни в кабинете, ни на витрине.
 *
 * Решение владельца продукта (1 октября 2026), и спека нужна именно
 * потому, что это решение, а не поломка: прочитав жалобу «футер
 * уходит» как про подвал, я его однажды уже вернул. Речь была про
 * нижнюю полосу кнопок.
 *
 * Проверяем и обратную сторону: на широком экране подвал на месте.
 * Правило — про ширину, а не про удаление блока.
 */
test.describe('подвал поддержки', () => {
  const SCREENS = ['/me/projects', '/', '/privacy', '/terms'];

  test('на тач-ширине его нет нигде, и хвоста от него не остаётся', async ({ page }) => {
    await signIn(page, box.sessions.client);
    for (const url of SCREENS) {
      await page.goto(url);
      await page.waitForTimeout(500);
      const res = await page.evaluate(() => {
        const host = document.querySelector('app-support-footer') as HTMLElement | null;
        const de = document.documentElement;
        let lowest = 0;
        document.querySelectorAll('body *').forEach((el) => {
          const e = el as HTMLElement;
          const b = e.getBoundingClientRect();
          if (b.height > 0 && getComputedStyle(e).position !== 'fixed') {
            lowest = Math.max(lowest, b.bottom + window.scrollY);
          }
        });
        return {
          height: host ? Math.round(host.getBoundingClientRect().height) : 0,
          tail: Math.round(de.scrollHeight - lowest),
        };
      });
      expect(res.height, `${url}: подвала на телефоне нет`).toBe(0);
      // Спрятан :host, а не его содержимое: пустая строка в потоке
      // оставила бы под экраном зазор, который читается как недогруз.
      expect(res.tail, `${url}: пустого хвоста под страницей нет`).toBeLessThanOrEqual(2);
    }
  });

  test('на широком экране подвал на месте', async ({ page }) => {
    await signIn(page, box.sessions.client);
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const url of SCREENS) {
      await page.goto(url);
      const footer = page.locator('app-support-footer footer');
      await expect(footer, `${url}: подвал на десктопе`).toBeVisible({ timeout: 15_000 });
    }
  });

  // Про документы отдельной проверки здесь нет намеренно: ссылки на
  // соглашение и политику стоят там, где человек под ними
  // подписывается — в окне входа, в окне регистрации заказчика и в
  // анкете (features/auth, features/client-register,
  // pages/onboarding). Это другая проверка и другой экран, а не
  // свойство подвала.
});
