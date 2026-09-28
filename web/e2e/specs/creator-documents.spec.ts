import { test, expect } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { call, callAs, createSandbox, dropSandbox, type Sandbox } from '../fixtures/sandbox';

/**
 * «Мои документы» в кабинете креатора.
 *
 * Договор человек ищет не тогда, когда снимает, а когда подписывает,
 * выставляет счёт или спорит. До этого искать его было негде: вид
 * `contract` знали база и API (миграция 00071 — «договор отдаётся
 * первым и выделяется в кабинете креатора плашкой»), а фронт про него
 * не знал вовсе. В форме менеджера его нельзя было выбрать, в кабинете
 * он лежал двадцать третьим чипом среди референсов, а списка по всем
 * проектам не было.
 *
 * Отсюда три проверки: договор виден в кабинете списком по всем
 * проектам, виден отдельно от материалов в карточке проекта — и не
 * виден чужому.
 */
let box: Sandbox;

const stamp = String(Date.now()).slice(-6);
const contract = `Договор №${stamp}`;
const guide = `Бренд-гайд ${stamp}`;

test.beforeAll(async () => {
  box = await createSandbox(`docs${stamp}`, { ownCreator: true, ownClient: true });

  // Кладём тем же запросом, что шлёт форма менеджера, — и договором, и
  // обычным материалом: разделение проверяется только когда рядом
  // лежит то, что разделять.
  await call(box, 'manager', 'post', `/api/v1/manager/projects/${box.projectId}/materials`, {
    kind: 'contract',
    title: contract,
    url: 'https://disk.example.com/contract.pdf',
    audience: 'creators',
  });
  await call(box, 'manager', 'post', `/api/v1/manager/projects/${box.projectId}/materials`, {
    kind: 'doc',
    title: guide,
    url: 'https://cdn.example.com/brand-guide.pdf',
    audience: 'creators',
  });
});

test.afterAll(() => dropSandbox(box));

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions.creator] as const,
  );
});

test('в кабинете есть «Мои документы» — договор с названием проекта и ссылкой', async ({
  page,
}) => {
  await page.goto('/me/creator/projects');

  const docs = page.locator('[data-test="creator-docs"]');
  await expect(docs, 'блок «Мои документы» нарисован').toBeVisible({ timeout: 20_000 });
  await expect(docs.getByRole('heading', { name: 'Мои документы' })).toBeVisible();

  const link = docs.getByRole('link', { name: contract });
  await expect(link).toHaveAttribute('href', 'https://disk.example.com/contract.pdf');
  // Открывается соседней вкладкой: уходить из кабинета за договором,
  // теряя место в списке проектов, незачем.
  await expect(link).toHaveAttribute('target', '_blank');

  // Название проекта рядом: договоров у человека столько же, сколько
  // проектов, и «Договор №12» без проекта — не ответ.
  await expect(docs).toContainText(box.title);

  // Бренд-гайд сюда НЕ попадает, хотя лежит тем же видом «документ».
  // Утопить договор в референсах — ровно то, ради чего список и делали.
  await expect(docs, 'материалы для съёмки в документы не попадают').not.toContainText(guide);
});

test('в карточке проекта договор стоит отдельно от материалов', async ({ page }) => {
  await page.goto(`/me/creator/projects/${box.projectId}`);

  const docs = page.locator('.docs');
  await expect(docs, 'блок документов проекта нарисован').toBeVisible({ timeout: 20_000 });
  await expect(docs.getByRole('link', { name: contract })).toBeVisible();
  // Плашкой — по классу, а не по цвету: договор один на проект, и
  // отличаться от референса он обязан.
  await expect(docs.locator('.doc.contract')).toHaveCount(1);

  // Материалы остались на своём месте и договор в них не дублируется.
  const chips = page.locator('.chips').filter({ hasText: guide });
  await expect(chips).toBeVisible();
  await expect(chips).not.toContainText(contract);
});

test('чужой договор не отдаётся: список строится по своим проектам', async () => {
  // Проверяем ручкой, а не экраном: «не показано» на экране бывает и
  // когда запрос упал, а утечка здесь — это чужие условия работы.
  const mine = await callAs(box.creator, 'get', '/api/v1/me/creator/documents');
  const titles = ((mine.items ?? []) as { title: string }[]).map((m) => m.title);
  expect(titles, 'свой договор на месте').toContain(contract);

  // Заказчик того же проекта в состав не входит — значит и документов
  // креаторов у него нет. 403 или пустой список: важно, что не чужой
  // договор.
  const foreign = await callAs(
    box.client,
    'get',
    '/api/v1/me/creator/documents',
    undefined,
    [200, 403],
  );
  const foreignTitles = (((foreign ?? {}).items ?? []) as { title: string }[]).map((m) => m.title);
  expect(foreignTitles, 'чужому договор не отдаём').not.toContain(contract);
});
