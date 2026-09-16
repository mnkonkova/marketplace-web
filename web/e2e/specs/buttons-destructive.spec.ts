import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { AUTH_KEY, lockFirstPeriod } from '../fixtures/world';
import { openCreatorTab, openManagerTab } from '../fixtures/ui';
import {
  call,
  callAs,
  createSandbox,
  dropSandbox,
  outboxEvents,
  ymd,
  type Role,
  type Sandbox,
} from '../fixtures/sandbox';

/**
 * Кнопки, которые меняют мир: нажимаем по-настоящему и смотрим на след.
 *
 * Обход всех кнопок (buttons-sweep) спрашивает у каждой одно — «хоть
 * что-нибудь произошло?». Этого хватает, чтобы поймать мёртвую кнопку, и
 * не хватает ни для чего больше: «Выплатить», отправившая запрос не туда,
 * обход проходит. Поэтому дорогие кнопки проверяются здесь по отдельности
 * и не по экрану, а по следу в API: строка начисления сменила статус,
 * выкладки появились в плане, проект исчез из выдачи, в воркер легло
 * событие.
 *
 * Читать след идём в API, а не в разметку: надпись «Выплачено» на экране
 * рисуется и тогда, когда до сервера ничего не дошло.
 *
 * У каждого теста свой одноразовый проект: жать «Удалить» и «Выплатить»
 * на общем стенде — значит ломать состояние соседним специям.
 */

const signIn = (context: BrowserContext, box: Sandbox, role: Role): Promise<void> =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );

/**
 * Начисления текущего периода — оттуда же, откуда их берёт экран.
 *
 * Отдельной ручки под них нет: они приходят вместе со счётом проекта, и
 * спрашивать их вторым путём значило бы проверять не то, что видит
 * менеджер.
 */
async function accruals(
  box: Sandbox,
): Promise<{ id: string; status: string; is_preview?: boolean }[]> {
  const body = await call(
    box,
    'manager',
    'get',
    `/api/v1/manager/projects/${box.projectId}/billing`,
  );
  return body.accruals ?? [];
}

async function publications(box: Sandbox): Promise<unknown[]> {
  const body = await call(
    box,
    'manager',
    'get',
    `/api/v1/manager/projects/${box.projectId}/publications`,
  );
  return body.items ?? [];
}

/**
 * Ответ на нажатие — по адресу И ПО МЕТОДУ.
 *
 * Метод обязателен, и это не аккуратность ради аккуратности. Фронт
 * ходит на другой origin, поэтому перед каждым POST браузер шлёт
 * CORS-проверку `OPTIONS`, и она приходит РАНЬШЕ настоящего ответа. Без
 * фильтра по методу `waitForResponse` ловил `OPTIONS 204` и объявлял
 * нажатие успешным, ничего о нём не узнав: 204 всегда «ok», тела нет,
 * проверять нечего. Та же ловушка с GET — регулярка на адрес проекта
 * совпадает и с обычной загрузкой карточки.
 */
function answer(
  page: Page,
  method: 'POST' | 'PUT' | 'DELETE' | 'GET',
  url: RegExp,
): Promise<import('@playwright/test').Response> {
  return page.waitForResponse((r) => r.request().method() === method && url.test(r.url()), {
    timeout: 20_000,
  });
}

/**
 * Нажать кнопку и, если она спросит «точно?», ответить.
 *
 * Денежные кнопки спрашивают подтверждение, и это правильно: между
 * нажатием и переводом денег должен стоять вопрос. Но спрашивают не все,
 * и тест, который ЖДЁТ окна всегда, падает на тех, что не спрашивают, —
 * то есть ругается на отсутствие лишнего шага.
 */
async function press(
  page: Page,
  button: Locator,
  method: 'POST' | 'PUT' | 'DELETE',
  url: RegExp,
): Promise<import('@playwright/test').Response> {
  const res = answer(page, method, url);
  await button.click();
  const ask = page.locator('.ant-modal-confirm').last();
  if (await ask.isVisible({ timeout: 1500 }).catch(() => false)) {
    await ask.getByRole('button', { name: 'OK' }).click();
  }
  return res;
}

test.describe('кнопки, которые меняют мир', () => {
  let box: Sandbox;

  test.beforeEach(async () => {
    box = await createSandbox(`dest${String(Date.now()).slice(-6)}`, {
      shape: 'stats',
      ownCreator: true,
      ownClient: true,
    });
  });

  test.afterEach(() => {
    // Песочница могла не собраться вовсе — тогда и сносить нечего, а
    // падение уборки прячет настоящую причину.
    dropSandbox(box);
  });

  test('деньги идут по очереди: пересчитать → подытожить → утвердить → выплатить', async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    await signIn(context, box, 'manager');
    await page.goto(`/manager/projects/${box.projectId}`);
    await openManagerTab(page, 'Начисления');

    // Пересчёт: до него строки начисления в базе нет вовсе — период
    // показан предварительным расчётом по фактам.
    const row = page.locator('.tbl tbody tr').first();
    // Ждём нарисованную строку, а не просто видимую таблицу: пометка
    // «Предварительно» приходит вместе с числами периода, то есть после
    // ответа сервера. Без этого ожидания «Пересчитать» нажимается по
    // ещё пустому экрану и запрос не уходит вовсе.
    //
    // По имени креатора её ждать нельзя: до пересчёта в строке стоит
    // «Без имени» — предварительный расчёт имя не подставляет. Это
    // дефект приложения, а не теста; описан в отчёте.
    await expect(row, 'строка периода нарисована').toContainText('Предварительно', {
      timeout: 15_000,
    });
    // Строка в ответе есть и до пересчёта, но она предварительная:
    // посчитана на лету, в базе её нет, и статуса у неё нет тоже.
    const preview = await accruals(box);
    expect(preview.length, 'период показан расчётом по фактам').toBeGreaterThan(0);
    expect(preview[0].is_preview, 'до пересчёта строка предварительная').toBe(true);
    expect(preview[0].status, 'у предварительной строки статуса нет').toBeFalsy();

    const recalc = answer(page, 'POST', /\/accruals\/recalc/);
    await page.getByRole('button', { name: 'Пересчитать' }).first().click();
    const recalculated = await recalc;
    expect(recalculated.ok(), await recalculated.text()).toBeTruthy();

    const afterRecalc = await accruals(box);
    expect(afterRecalc.length, 'после пересчёта строка начисления есть').toBeGreaterThan(0);
    expect(afterRecalc[0].status).toBe('draft');

    // И вот главное правило, которое стоит проверить именно нажатием:
    // пока период ИДЁТ, утверждать нечего. Числа завтра будут другими, и
    // кнопки «Утвердить» на экране нет — сколько ни пересчитывай.
    //
    // Спрашивать это сразу после ответа нельзя: экран ещё не перерисован,
    // и «кнопки нет» верно по той простой причине, что не нарисовано
    // ещё ничего. Такая проверка проходила ВСЕГДА — в том числе если бы
    // кнопка появлялась. Поэтому сперва дожидаемся перерисовки: сам
    // экран говорит о ней сообщением «Пересчитано», а следом ячейка
    // действий в строке — то самое место, где кнопка и стояла бы.
    await expect(page.locator('.ant-message'), 'экран сказал, что пересчитал').toContainText(
      'Пересчитано',
      { timeout: 15_000 },
    );
    const actions = row.locator('td.acts');
    await expect(actions, 'ячейка действий у строки нарисована').toBeVisible({ timeout: 15_000 });
    await expect(
      actions.getByRole('button', { name: 'Утвердить' }),
      'пока период идёт, утверждать нечего',
    ).toHaveCount(0);

    // Подытог ставит воркер через две недели после конца периода —
    // дождаться его браузером нельзя, время не перемотать. Кладём
    // состояние данными и проверяем то, что после него делает человек.
    lockFirstPeriod(box.projectId);
    await page.reload();
    await openManagerTab(page, 'Начисления');

    const approve = page.getByRole('button', { name: 'Утвердить' }).first();
    await expect(approve, 'подытоженную строку можно утвердить').toBeVisible({ timeout: 15_000 });
    // Утверждение спрашивает «точно?» и называет, у кого именно, — это и
    // есть защита от нажатия не глядя.
    const approved = await press(page, approve, 'POST', /\/accruals\/.+\/approve/);
    expect(approved.ok(), await approved.text()).toBeTruthy();
    expect((await accruals(box))[0].status).toBe('approved');

    // И только теперь — выплата. Порядок здесь и есть правило: между
    // «посчитали» и «отправили деньги» проходит время.
    const pay = page.getByRole('button', { name: 'Выплачено' }).first();
    await expect(pay, 'утверждённую строку можно выплатить').toBeVisible({ timeout: 15_000 });
    const paid = await press(page, pay, 'POST', /\/accruals\/.+\/paid/);
    expect(paid.ok(), await paid.text()).toBeTruthy();
    expect((await accruals(box))[0].status).toBe('paid');
  });

  test('«Проставить даты» действительно ставит выкладки в план', async ({ context, page }) => {
    test.setTimeout(150_000);
    const before = (await publications(box)).length;

    await signIn(context, box, 'manager');
    await page.goto(`/manager/projects/${box.projectId}`);
    await page.getByRole('button', { name: 'Проставить даты' }).first().click();

    const dialog = page.locator('.ant-modal').filter({ hasText: 'Дни выкладки' });
    await expect(dialog).toBeVisible();

    // Кому и когда. Кнопка создания заперта, пока не выбрано и то, и
    // другое, — и это правило проверяем нажатием: сперва пробуем без
    // дат.
    // Креатор в проекте один и уже отмечен — нажатие бы его СНЯЛО, и
    // создавать стало бы некому. Отмечаем, только если не отмечен.
    const crew = dialog.locator('.pickchips.crew .pick').first();
    if (!(await crew.evaluate((el) => el.classList.contains('on')))) await crew.click();
    const submit = dialog.getByRole('button', { name: /Создать выкладки|Добавить даты/ });
    await expect(submit, 'без выбранных дней создавать нечего').toBeDisabled();

    // Свободные дни следующего месяца: в текущем часть уже занята, а на
    // занятый день второй выкладки не поставить.
    await dialog.getByRole('button', { name: 'Вперёд' }).click();
    const free = dialog.locator('.mcal .dc:not(.pad):not(.past):not(.set)');
    await free.nth(9).click();
    await free.nth(11).click();
    await expect(submit).toBeEnabled();

    const created = await press(page, submit, 'POST', /\/publications\/batch/);
    expect(created.status(), await created.text()).toBe(201);

    const after = (await publications(box)).length;
    expect(after, 'выкладок стало на две больше').toBe(before + 2);

    // И то, ради чего заводился воркер: нажатие оставило запись, из
    // которой потом собирается сообщение в чат. Без неё отправлять
    // нечего — какой бы бот ни стоял на том конце.
    expect(outboxEvents(box.projectId), 'нажатие записалось в воркер').toContain(
      'project.publications_created',
    );
  });

  test('«Удалить проект» убирает его из выдачи, и подтверждение названием обязательно', async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    await signIn(context, box, 'admin');
    await page.goto(`/manager/projects/${box.projectId}`);

    await page.getByRole('button', { name: 'Действия с проектом' }).first().click();
    // Пункт меню, а не кнопка: у него явный role="menuitem", и он же
    // перекрывает роль тега. Искать его как кнопку — не найти.
    await page.getByRole('menuitem', { name: 'Удалить проект' }).click();

    const modal = page.locator('.ant-modal').filter({ hasText: 'Удалить проект' });
    await expect(modal).toBeVisible();

    // Сперва без подтверждения: проект обязан остаться на месте. В этом и
    // смысл поля — оно стоит между раздражением и безвозвратным
    // удалением чужой работы.
    await modal.getByRole('button', { name: 'Удалить' }).click();
    await page.waitForTimeout(800);
    const stillThere = await call(
      box,
      'manager',
      'get',
      `/api/v1/manager/projects/${box.projectId}`,
      undefined,
      [200, 404],
    );
    expect(stillThere?.id, 'без совпадения названия проект не удаляется').toBe(box.projectId);

    // А теперь с названием — и проект пропадает. Метод обязателен:
    // адрес `/admin/projects/<id>` совпадает и с обычным GET карточки.
    await modal.locator('input').first().fill(box.title);
    const gone = await press(
      page,
      modal.getByRole('button', { name: 'Удалить' }),
      'DELETE',
      new RegExp(`/admin/projects/${box.projectId}$`),
    );
    expect(gone.ok(), await gone.text()).toBeTruthy();

    // «Удалить» — это отмена, а не стирание: строка остаётся, статус
    // становится cancelled. Проверяем именно это, а не «записи нет»:
    // ошибочно удалённый проект обязан быть восстановим, и тест, который
    // требует исчезновения, требовал бы обратного.
    const check = await call(
      box,
      'manager',
      'get',
      `/api/v1/manager/projects/${box.projectId}`,
      undefined,
      [200, 404],
    );
    expect(check?.status, 'проект отменён').toBe('cancelled');

    // И из работы он ушёл: в списке своих проектов менеджер его больше не
    // видит — иначе «удалил» ничего бы не значило.
    const mine = await call(box, 'manager', 'get', '/api/v1/manager/projects');
    expect(
      (mine.items ?? []).map((p: { id: string }) => p.id),
      'из списка проектов пропал',
    ).not.toContain(box.projectId);

    expect(outboxEvents(box.projectId), 'отмена записалась в воркер').toContain(
      'project.cancelled',
    );
  });

  /**
   * «Напомнить» — единственная кнопка, которая шлёт человеку сообщение.
   *
   * Проверять её по экрану бессмысленно: надпись «Отправлено» рисуется и
   * тогда, когда до воркера ничего не дошло. Смотрим в outbox — запись в
   * него и есть «сообщение отправлено»; дальше начинается доставка, и
   * без записи доставлять нечего.
   */
  test('«Напомнить» оставляет запись в воркере, и второй раз за день не шлёт', async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    // Напоминать есть о чём, только пока выкладка открыта: сданную
    // трогать незачем, и кнопка на ней честно отвечает «напоминать не о
    // чем». Поэтому ставим в план ещё один день.
    await call(
      box,
      'manager',
      'post',
      `/api/v1/manager/projects/${box.projectId}/publications/batch`,
      {
        creator_user_ids: [box.creator.userId],
        dates: [ymd(3)],
      },
    );

    await signIn(context, box, 'manager');
    await page.goto(`/manager/projects/${box.projectId}`);

    const remind = page.getByRole('button', { name: 'Напомнить' }).first();
    await expect(remind, 'у открытой выкладки есть чем напомнить').toBeVisible({ timeout: 15_000 });

    const sent = await press(page, remind, 'POST', /\/publications\/.+\/remind/);
    expect(sent.ok(), await sent.text()).toBeTruthy();
    expect(
      outboxEvents(box.projectId).filter((e) => e.startsWith('project.')).length,
      'напоминание записалось в воркер',
    ).toBeGreaterThan(0);
    const afterFirst = outboxEvents(box.projectId).length;

    // Второе нажатие в тот же день не шлёт ничего — и это правило, а не
    // случайность: два одинаковых сообщения подряд креатору не нужны.
    // Отказ приходит осмысленный, а не «всё хорошо».
    await page.reload();
    const again = await press(
      page,
      page.getByRole('button', { name: 'Напомнить' }).first(),
      'POST',
      /\/publications\/.+\/remind/,
    );
    expect(again.status(), await again.text()).toBe(409);
    expect((await again.json()).error).toBe('already_reminded');
    expect(outboxEvents(box.projectId).length, 'второй записи в воркере не появилось').toBe(
      afterFirst,
    );
  });

  /**
   * «Скачать отчёт» — единственная кнопка, у которой результат не экран.
   *
   * Обход засчитывает её по ушедшему запросу, и этого мало: пустой файл
   * или HTML вместо таблицы выглядят ровно так же. Поэтому здесь
   * проверяется САМ ответ — тип, имя файла и то, что в нём есть строки.
   */
  test('«Скачать отчёт» отдаёт заказчику непустую таблицу', async ({ context, page }) => {
    test.setTimeout(120_000);
    await signIn(context, box, 'client');
    await page.goto(`/me/projects/${box.projectId}`);

    const download = page.getByRole('button', { name: 'Скачать отчёт' }).first();
    await expect(download).toBeVisible({ timeout: 15_000 });

    const csv = answer(page, 'GET', /\/report\.csv/);
    await download.click();
    const report = await csv;
    expect(report.ok(), await report.text()).toBeTruthy();

    const text = await report.text();
    const lines = text.split('\n').filter((l) => l.trim());
    // Заголовок плюс по строке на площадку: ролик один, площадок пять, и
    // «пусто» от «не доехало» иначе не отличить.
    expect(lines.length, 'в отчёте заголовок и пять строк площадок').toBe(6);
    expect(lines[0], 'первая строка — заголовки столбцов').toContain('ролик');
    // Выгрузка про СВОЙ проект: в ней стоят ссылки песочницы и имя её
    // креатора, а не чей-то чужой ролик.
    expect(text, 'в отчёте ссылки песочницы').toContain(`video/900${box.tag}`);
    expect(text, 'в отчёте имя креатора, а не uuid').toContain(box.creator.name);
  });

  test('«Выйти» гасит сессию, а не только уводит с экрана', async ({ context, page }) => {
    await signIn(context, box, 'manager');
    await page.goto('/manager/projects');
    await page.getByRole('button', { name: 'Выйти' }).first().click();
    await page.waitForTimeout(1000);

    const left = await page.evaluate((key) => window.localStorage.getItem(key as string), AUTH_KEY);
    expect(left, 'токены стёрты из браузера').toBeFalsy();
    expect(page.url(), 'из CRM увело').not.toContain('/manager');
  });

  /**
   * Тумблер «занят» в кабинете креатора — самая дешёвая на вид кнопка с
   * самыми дальними последствиями.
   *
   * Она не меняет ни одного проекта: она помечает ЧЕЛОВЕКА занятым в
   * месяце, и после этого подбор перестаёт брать его в заказы — на
   * экране проекта об этом не сказано ничего. Поэтому проверяем не
   * подсветку, а отметку на сервере.
   */
  test('«занят» в кабинете креатора доезжает до сервера', async ({ context, page }) => {
    test.setTimeout(120_000);
    await signIn(context, box, 'creator');
    await page.goto(`/me/creator/projects/${box.projectId}`);

    // Занятость лежит вместе с выкладками: и то и другое про «когда я
    // могу снимать», а кабинет разложен по вкладкам.
    await openCreatorTab(page, 'Мои выкладки');

    const busy = page.getByRole('button', { name: 'занят' }).first();
    await expect(busy, 'в кабинете есть чем отметить занятость').toBeVisible({ timeout: 15_000 });

    const saved = await press(page, busy, 'PUT', /\/me\/creator\/availability/);
    expect(saved.ok(), await saved.text()).toBeTruthy();

    const marks = await callAs(box.creator, 'get', '/api/v1/me/creator/availability');
    const busyMonths = ((marks.items ?? []) as { month: string; is_available: boolean }[]).filter(
      (m) => !m.is_available,
    );
    expect(busyMonths.length, 'отметка «занят» долетела до сервера').toBeGreaterThan(0);
  });
});

/**
 * А дальше — то, ради чего сессию и гасят: без неё в CRM не войти.
 *
 * Отдельным тестом и без подкладывания сессии. В тесте выше её кладёт
 * addInitScript, и он делает это при КАЖДОЙ загрузке страницы — переход
 * на адрес CRM сразу после выхода приносил токены обратно, и проверка
 * «не пускает» проверяла бы ровно наоборот.
 */
test('без сессии адрес CRM уводит на главную', async ({ page }) => {
  test.setTimeout(60_000);
  // Ждём разметку, а не полную загрузку: увозит нас на главную, а она
  // тянет портфолио с видео и «загрузилась» может не сказать вовсе.
  await page.goto('/manager/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  expect(page.url()).toBe('http://localhost:4200/');
});

/**
 * «Взять на себя» — отдельно от песочницы выше: проект для неё обязан
 * быть ничей, а песочницу заводит менеджер и сразу ей владеет.
 */
test('«Взять на себя» ставит менеджера на проект', async ({ context, page }) => {
  test.setTimeout(120_000);
  const box = await createSandbox(`claim${String(Date.now()).slice(-6)}`, {
    shape: 'stats',
    ownClient: true,
  });
  try {
    // Снимаем менеджера — теперь проект ничей и виден во «Входящих».
    await call(box, 'admin', 'post', `/api/v1/admin/projects/${box.projectId}/assign`, {
      manager_user_id: null,
    });

    await signIn(context, box, 'manager');
    await page.goto(`/manager/projects/${box.projectId}`);
    const claimed = answer(page, 'POST', /\/claim$/);
    await page.getByRole('button', { name: 'Взять на себя' }).first().click();
    const res = await claimed;
    expect(res.ok(), await res.text()).toBeTruthy();

    const project = await call(box, 'manager', 'get', `/api/v1/manager/projects/${box.projectId}`);
    expect(project.assigned_to_user_id, 'проект встал на нажавшего').toBe(box.manager.userId);
    expect(outboxEvents(box.projectId), 'взятие проекта записалось в воркер').toContain(
      'project.assigned',
    );
  } finally {
    dropSandbox(box);
  }
});
