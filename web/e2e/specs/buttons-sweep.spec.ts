import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { AUTH_KEY } from '../fixtures/world';
import { createSandbox, dropSandbox, type Role, type Sandbox } from '../fixtures/sandbox';
import { openManagerTab } from '../fixtures/ui';

/** Адрес API: им же шумит фоновый опрос в проверке самого обхода. */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';

/**
 * Обход всех кнопок: каждая что-то делает и ни одна не роняет страницу.
 *
 * Поводом была не придирчивость. Одна ошибка в отрисовке гасит на
 * странице ВСЕ обработчики разом, и выглядит это не как одна ошибка, а
 * как набор независимых поломок: «не прожимается фильтр», «не
 * открывается окно», «не работает сдать». Сколько их, три или тридцать,
 * по экрану не видно, и чинить начинают поодиночке.
 *
 * Поэтому проверяем не отдельные кнопки, а все подряд, и спрашиваем на
 * каждой одно: после нажатия хоть что-нибудь произошло? Ушёл НОВЫЙ
 * запрос, сменился адрес, изменилась разметка. Не произошло ничего —
 * кнопка мёртвая, и неважно, почему именно.
 *
 * Перед КАЖДОЙ кнопкой экран загружается заново. Это медленно и это
 * обязательно: первая же кнопка открывает панель или окно, которое
 * накрывает экран, и без перезагрузки все последующие кнопки
 * оказываются «недоступны» — обход выдавал тридцать выдуманных поломок,
 * за которыми настоящую было не разглядеть.
 *
 * Работает обход в песочнице — своём проекте со своими людьми. Поэтому
 * запрет «не жать мутирующие» снят: жать можно всё, потому что ломать
 * больше нечего, кроме своего же одноразового проекта. Осталось ровно
 * два исключения, и у каждого своя причина, написанная рядом.
 *
 * Чего обход НЕ доказывает: что кнопка делает ИМЕННО ТО, что обещает.
 * Это другая проверка и живёт она рядом — buttons-destructive.spec.ts:
 * там у каждой дорогой кнопки сверяется след в API.
 */

/**
 * Кнопки, которые обход не жмёт, и почему.
 *
 * Список короткий намеренно: каждая строка здесь — дыра в покрытии, и
 * пускать сюда что-то «на всякий случай» нельзя.
 */
const SKIP: { re: RegExp; why: string }[] = [
  {
    re: /^Выйти$/,
    why: 'гасит сессию — мести после неё нечего. Проверена отдельно, в buttons-destructive.',
  },
  {
    re: /^(B|I|S|@|⋮≡)$/,
    why:
      'команды редактора комментария: без выделенного текста они и не должны ничего менять. ' +
      'Проверяются ниже отдельным тестом, по-настоящему — с текстом и выделением.',
  },
];

/** Сколько кнопок с одинаковой подписью жмём: первую, среднюю и последнюю. */
const SAME_LABEL_LIMIT = 3;

/** Сколько ждём после нажатия и столько же — фонового шума до него. */
const SETTLE_MS = 700;

/**
 * Экран обхода.
 *
 * Вкладок у карточки проекта на десктопе больше нет: разделы стоят
 * одной страницей сверху вниз, а полоса вкладок осталась только на
 * телефоне. Пока они были, обход открывал каждый раздел отдельным
 * заходом; теперь он видит их все с первого — и открывать нечего.
 */
interface Screen {
  url: string;
  /** Подпись вкладки, которую надо открыть после загрузки. */
  tab?: string;
}

const screenName = (s: Screen): string => (s.tab ? `${s.url} › ${s.tab}` : s.url);

function screens(role: Role, box: Sandbox): Screen[] {
  const project = box.projectId;
  if (role === 'client') {
    return [{ url: '/me/projects' }, { url: `/me/projects/${project}` }];
  }
  if (role === 'creator') {
    return [{ url: '/me/creator/projects' }, { url: `/me/creator/projects/${project}` }];
  }
  if (role === 'manager') {
    const card = `/manager/projects/${project}`;
    return [{ url: '/manager' }, { url: '/manager/projects' }, { url: card }];
  }
  return [
    { url: '/admin' },
    { url: '/admin/projects' },
    { url: '/admin/team' },
    { url: '/admin/tariff' },
    { url: '/admin/checklists' },
    { url: '/admin/pipelines' },
    { url: '/admin/productions' },
    { url: '/admin/users' },
  ];
}

/**
 * Дождаться, пока экран догрузится.
 *
 * Не networkidle: у приложения есть фоновые запросы, и полной тишины оно
 * не даёт вовсе — обход на таком ожидании просто выходил по времени.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
}

/**
 * Открыть экран: адрес плюс, если надо, вкладка карточки.
 *
 * Переход повторяем один раз, если его перебил переход самого
 * приложения. Так бывает по делу: страница на старте читает адрес и
 * дописывает в него вкладку или фильтр, и наш `goto`, начатый в ту же
 * миллисекунду, отменяется чужим. Это не поломка кнопки и не находка —
 * это гонка загрузки, и молча ронять на ней весь обход нельзя.
 */
async function open(page: Page, screen: Screen): Promise<boolean> {
  try {
    await page.goto(screen.url);
  } catch (e) {
    if (!/interrupted by another navigation/i.test(String(e))) throw e;
    await page.waitForTimeout(SETTLE_MS);
    await page.goto(screen.url);
  }
  await settle(page);
  if (!screen.tab) return true;
  // Сперва ищем ВКЛАДКУ и только потом любую кнопку с таким названием.
  //
  // Над полосой вкладок менеджера стоит предупреждение о предоплате с
  // кнопкой «Открыть начисления», и в разметке она идёт раньше вкладки
  // «Начисления». Поиск по кнопке брал её — экран открывался нажатием
  // той самой кнопки, которую обход потом объявлял мёртвой: к моменту
  // её очереди раздел уже был открыт, и нажатие ничего не меняло.
  const asTab = page.getByRole('tab', { name: new RegExp(`^${screen.tab}`) });
  const tab = (await asTab.count())
    ? asTab.first()
    : page.getByRole('button', { name: new RegExp(`^${screen.tab}`) }).first();
  if (!(await tab.count())) return false;
  await tab.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
  return true;
}

/**
 * Отпечаток экрана — адрес, текст и форма разметки.
 *
 * Прежний отпечаток был `innerHTML.length` плюс первые четыре тысячи
 * знаков `innerText`, и врал он в обе стороны. В плюс: относительное
 * время («2 минуты назад») и тикающие счётчики меняли его сами, без
 * всякого нажатия, и мёртвая кнопка засчитывалась живой. В минус:
 * правка дальше четырёхтысячного знака при той же длине разметки не
 * видна вовсе.
 *
 * Поэтому здесь: ВЕСЬ текст, свёрнутый в хеш, — обрезать нечего;
 * относительное время заменено меткой, чтобы не тикало; и отдельно
 * форма разметки (теги и классы), потому что переключение вкладки может
 * не поменять ни знака текста, а класс `.on` переехать.
 *
 * Вместе с классами берём СОСТОЯНИЕ: aria-pressed, aria-selected,
 * aria-current, aria-expanded, checked и disabled. Состояние, выраженное
 * только атрибутом, — это обычный способ разметить переключатель, и
 * обход объявлял такие кнопки мёртвыми: «да» и «нет» в проверке ролика
 * ставят ответ через aria-pressed, ни текста, ни класса при этом не
 * меняя. Ответ на экране появлялся, а отпечаток оставался прежним.
 */
function fingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hash = (s: string): string => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(36);
    };
    const text = (document.body.innerText || '')
      .replace(/\d{1,2}:\d{2}(:\d{2})?/g, '⏱')
      .replace(
        /\d+\s*(сек|секунд[а-я]*|мин|минут[а-я]*|час[а-я]*|дн[а-я]*|недел[а-я]*|месяц[а-я]*|год[а-я]*|лет)\.?\s*назад/gi,
        '⏱',
      )
      .replace(/только что/gi, '⏱');
    const stateAttrs = [
      'aria-pressed',
      'aria-selected',
      'aria-current',
      'aria-expanded',
      'aria-checked',
      'checked',
      'disabled',
      'open',
    ];
    const shape: string[] = [];
    document.querySelectorAll('*').forEach((el) => {
      const state = stateAttrs
        .map((a) => (el.hasAttribute(a) ? `${a}=${el.getAttribute(a)}` : ''))
        .filter(Boolean)
        .join(',');
      shape.push(`${el.tagName}.${(el as HTMLElement).className}${state ? `[${state}]` : ''}`);
    });
    // Прокрутка — тоже след нажатия: «Написать менеджеру» ничего не
    // запрашивает и ничего не перерисовывает, она увозит к редактору
    // внизу длинной страницы. Без этого обход объявлял её мёртвой,
    // будучи при этом уверенным в себе.
    return [
      location.href,
      Math.round(window.scrollY),
      text.length,
      hash(text),
      shape.length,
      hash(shape.join('|')),
    ].join(' ');
  });
}

/** Запрос к API: метод и путь без хоста и query. */
function apiKey(method: string, url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith('/api/v1/')) return null;
    return `${method} ${u.pathname}`;
  } catch {
    return null;
  }
}

/** Что накопилось за окно наблюдения. */
interface Traffic {
  stop: () => Set<string>;
}

function watch(page: Page): Traffic {
  const seen = new Set<string>();
  const onReq = (req: { method(): string; url(): string }): void => {
    const key = apiKey(req.method(), req.url());
    if (key) seen.add(key);
  };
  page.on('request', onReq);
  return {
    stop: () => {
      page.off('request', onReq);
      return seen;
    },
  };
}

interface Finding {
  screen: string;
  label: string;
  why?: string;
}

/**
 * Переключатель уже включён: нажимать его второй раз незачем.
 *
 * Отвечаем «нет», если спросить не удалось. Страница могла уехать
 * переходом ровно в этот момент — и тогда «включён ли он» вопрос уже не
 * к ней. Считать такой случай включённым значило бы тихо пропустить
 * кнопку, а падать на нём — ронять весь обход из-за чужой навигации.
 */
async function isActive(b: Locator): Promise<boolean> {
  return b
    .evaluate(
      (el) =>
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-pressed') === 'true' ||
        // Раздел, на котором мы стоим. Вкладки кабинета помечают его
        // не классом и не aria-selected, а aria-current="page" — это
        // и есть «вы уже здесь», и нажатие по нему ничего не делает
        // ровно потому, что делать нечего.
        el.getAttribute('aria-current') === 'page' ||
        /(^|\s)(on|active|selected)(\s|$)/.test((el as HTMLElement).className) ||
        (el as HTMLElement).className.includes('ant-tabs-tab-active'),
    )
    .catch(() => false);
}

/**
 * Всё, по чему нажимают.
 *
 * Локатор один на оба прохода, но адресуется кнопка НЕ номером в нём.
 * Номер держался на том, что экран перед каждым нажатием тот же самый,
 * — а он не тот же: карточка проекта стала одной длинной страницей, и
 * первое же нажатие по верхней тревоге («Подтвердить конец периода»)
 * убирает её вместе с двумя кнопками. Дальше весь список съезжает, и
 * обход честно докладывал двадцать шесть «уехало» подряд — то есть не
 * жал больше ничего.
 */
function clickables(page: Page): Locator {
  return page.locator(
    'button:visible, [role="button"]:visible, [role="menuitem"]:visible, a[href]:visible',
  );
}

/** Одна кнопка: как подписана, какая по счёту среди тёзок и где стоит. */
interface Command {
  /** Порядок обхода: жмём сверху вниз, как читает человек. */
  index: number;
  label: string;
  /**
   * Какая это по счёту кнопка с такой подписью.
   *
   * Подпись плюс порядковый номер среди тёзок — то, чем кнопку называет
   * человек («вторая „Заменить“»), и то единственное, что переживает
   * перерисовку страницы. Номер в общем списке — не переживает.
   */
  nth: number;
}

/**
 * Подписи всего, по чему человек нажимает ради действия.
 *
 * Ссылки — наравне с кнопками: в CRM половина переходов сделана
 * `routerLink`'ом на <a>, и обход по одним <button> обходил ровно те
 * места, на которые жалуются. Внешние ссылки пропускаем: они уводят из
 * приложения, и проверять нам там нечего.
 */
async function commands(page: Page): Promise<Command[]> {
  const found: Command[] = [];
  const all = await clickables(page).all();
  // Счётчик тёзок ведём по ВСЕМ кнопкам подряд, а не по отобранным:
  // адресация должна совпадать с той, которой кнопку потом ищут, а та
  // о наших отборах не знает и знать не может — на втором проходе
  // кнопка могла запереться или уехать во внешнюю ссылку.
  const seen = new Map<string, number>();
  for (let i = 0; i < all.length; i += 1) {
    const b = all[i];
    const text = ((await b.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const nth = seen.get(text) ?? 0;
    seen.set(text, nth + 1);
    const href = await b.getAttribute('href');
    const target = await b.getAttribute('target');
    if (target === '_blank') continue;
    if (href && /^(https?:|mailto:|tel:)/.test(href)) continue;
    if (SKIP.some((s) => s.re.test(text))) continue;
    // Клетка календаря: число месяца. День без выкладок и правда ничего
    // не открывает — это не поломка, а отсутствие содержимого.
    if (/^\d+$/.test(text)) continue;
    if (await b.isDisabled().catch(() => true)) continue;
    // Уже включённый переключатель. Нажатие по активной вкладке или по
    // выбранному окну не делает ничего — и правильно делает.
    if (await isActive(b)) continue;
    // Ссылка на тот же адрес, где мы стоим (логотип на своей же
    // странице). Нажатие по ней и не должно ничего менять.
    if (href && new URL(href, page.url()).pathname === new URL(page.url()).pathname) continue;
    found.push({ index: i, label: text, nth });
  }
  return sample(found);
}

/**
 * Найти кнопку заново — по подписи и по счёту среди тёзок.
 *
 * Перебираем весь список сами, а не спрашиваем `getByText`: подпись
 * сверяем по той же нормализации, что и при отборе (в «Песочница
 * (e2e-sandbox) e2e-client» перенос строки ставит браузер), и нам нужен
 * именно N-й тёзка, а не первый попавшийся.
 */
async function locate(page: Page, cmd: Command): Promise<Locator | null> {
  // Подписи снимаем ОДНИМ заходом в страницу, а не вопросом на каждую
  // кнопку. Спрашивать по одной — шесть десятков переходов через мост
  // на КАЖДОЕ нажатие: обход упирался в свои же пять минут и падал по
  // времени, ничего при этом не найдя.
  const list = clickables(page);
  const texts = await list
    .evaluateAll((els) =>
      els.map((el) => ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()),
    )
    .catch(() => [] as string[]);

  let seen = 0;
  for (let i = 0; i < texts.length; i += 1) {
    if (texts[i] !== cmd.label) continue;
    if (seen === cmd.nth) return list.nth(i);
    seen += 1;
  }
  return null;
}

/**
 * Из одинаково подписанных берём три: первую, среднюю и последнюю.
 *
 * Прежний обход схлопывал их в одну — из двадцати «Открыть» проверялась
 * первая, и мёртвая девятнадцатая проезжала молча. Жать все двадцать
 * тоже незачем: перед каждой перезагрузка экрана, и обход упёрся бы во
 * время. Три — это первая, какая-нибудь из середины и последняя: если
 * ряд собран циклом, ломаются они все разом, а если руками — крайние
 * отличаются чаще всего.
 */
function sample(all: Command[]): Command[] {
  const byLabel = new Map<string, Command[]>();
  for (const c of all) {
    const list = byLabel.get(c.label) ?? [];
    list.push(c);
    byLabel.set(c.label, list);
  }
  const picked: Command[] = [];
  for (const list of byLabel.values()) {
    if (list.length <= SAME_LABEL_LIMIT) {
      picked.push(...list);
      continue;
    }
    picked.push(list[0], list[Math.floor(list.length / 2)], list[list.length - 1]);
  }
  return picked.sort((a, b) => a.index - b.index);
}

/** Итог обхода одного экрана. */
interface Sweep {
  /** Сколько кнопок нашли. */
  found: number;
  /** Сколько на самом деле нажали. */
  pressed: number;
}

/**
 * Свести счёт: найдено = нажато + осознанно пропущено + находки.
 *
 * Без этой арифметики «ни одной мёртвой» может означать «ни одной не
 * нажали»: любой `continue` в цикле тихо уменьшает покрытие, и по
 * зелёному отчёту это не видно вовсе.
 */

async function sweep(
  page: Page,
  screen: Screen,
  dead: Finding[],
  blocked: Finding[],
  shifted: Finding[],
  skipped: Finding[],
): Promise<Sweep> {
  const where = screenName(screen);
  if (!(await open(page, screen))) {
    blocked.push({ screen: where, label: screen.tab ?? '', why: 'вкладки на экране нет' });
    return { found: 0, pressed: 0 };
  }
  const list = await commands(page);
  let pressed = 0;

  for (const cmd of list) {
    const label = cmd.label;
    await open(page, screen);
    // Кнопку ищем заново по подписи: экран мог перерисоваться иначе —
    // например, нажатая раньше тревога исчезла вместе с двумя своими
    // кнопками. Не нашлась — это находка, а не повод молча пропустить:
    // «ни одной мёртвой» не должно означать «ни одной не нажали».
    const target = await locate(page, cmd);
    if (!target) {
      // Кнопки больше нет — и это ожидаемо, а не находка. Обход жмёт
      // всё подряд на своей песочнице, и мир от этого меняется:
      // подтвердил конец периода — тревога ушла вместе с «Другая
      // дата», и на перезагруженном экране её действительно нет.
      //
      // Экран здесь загружен заново, а не завален чужим окном: пропуск
      // означает ровно «этого больше нет в проекте», а не «не дотянулись».
      // Спрятать за этим настоящую пропажу кнопки не выйдет: рядом
      // стоит требование нажать больше четырёх пятых найденного, и
      // разом исчезнувший блок его уронит.
      skipped.push({ screen: where, label, why: 'исчезла после предыдущих нажатий' });
      continue;
    }
    if (await target.isDisabled().catch(() => true)) {
      shifted.push({ screen: where, label, why: 'кнопка заперта' });
      continue;
    }
    if (await isActive(target)) {
      // Переключатель, который к моменту нажатия оказался уже включённым:
      // нажимать его незачем, но и молчать об этом нельзя — счёт нажатий
      // иначе не сойдётся, а пропуск спрячется.
      skipped.push({ screen: where, label, why: 'к нажатию оказался уже включённым' });
      continue;
    }

    // Довести кнопку до видимости ДО замера, а не нажатием.
    //
    // Playwright сам подкручивает страницу к кнопке перед кликом, и без
    // этой строки прокрутка засчитывалась как след нажатия: любая
    // кнопка ниже сгиба «что-то делала» просто потому, что до неё
    // доскроллили. Заодно уезжает и разметка — липкие шапки и ленивые
    // блоки меняются от самой прокрутки.
    await target.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);

    // Фоновый шум: что экран запрашивает САМ, без нажатия, и меняет ли
    // он при этом разметку. Прежний обход считал «что-то произошло» по
    // флагу, который поднимал ЛЮБОЙ запрос за 700 мс, — то есть мёртвая
    // кнопка на экране с опросом засчитывалась живой.
    const idle = watch(page);
    const before = await fingerprint(page);
    await page.waitForTimeout(SETTLE_MS);
    const background = idle.stop();
    const quiet = await fingerprint(page);
    // Экран живой сам по себе (тикающий счётчик, относительное время):
    // по разметке о нажатии судить нельзя, остаются запросы и адрес.
    const domNoisy = before !== quiet;

    const traffic = watch(page);
    // Промах по кнопке и мёртвая кнопка — РАЗНЫЕ находки, и смешивать их
    // нельзя: до одной нельзя дотянуться, вторая ничего не делает.
    const failure = await target
      .click({ timeout: 4000 })
      .then(() => '')
      // Первая строка ошибки — «Timeout 4000ms exceeded», и по ней не
      // видно НИЧЕГО: перекрыл ли кнопку чужой слой, уехала ли она за
      // край, крутится ли анимация. Причина стоит в журнале попыток
      // ниже, поэтому берём и её — разбирать это приходится по отчёту,
      // когда страницы под рукой уже нет.
      .catch((e: Error) => {
        const lines = String(e.message)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const why = lines.find((l) => /intercept|outside|not visible|not stable|disabled/i.test(l));
        return why ? `${lines[0]} ${why}` : lines[0];
      });
    await page.waitForTimeout(SETTLE_MS);
    const during = traffic.stop();

    if (failure) {
      blocked.push({ screen: where, label, why: failure });
      continue;
    }
    pressed += 1;

    const after = await fingerprint(page);
    const wrote = [...during].some((k) => !k.startsWith('GET '));
    const asked = [...during].some((k) => k.startsWith('GET ') && !background.has(k));
    const drawn = !domNoisy && after !== quiet;
    const moved = after.split(' ')[0] !== quiet.split(' ')[0];
    const scrolled = after.split(' ')[1] !== quiet.split(' ')[1];

    if (process.env.SWEEP_LOG) {
      const why = [
        wrote && 'запрос',
        asked && 'новый GET',
        drawn && 'разметка',
        moved && 'адрес',
        scrolled && 'прокрутка',
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`  · «${label}» → ${why || 'НИЧЕГО'}`);
    }
    if (!wrote && !asked && !drawn && !moved && !scrolled) {
      dead.push({
        screen: where,
        label,
        why: domNoisy ? 'экран шумит сам, и даже нового запроса не ушло' : undefined,
      });
    }
  }
  return { found: list.length, pressed };
}

const signIn = (context: BrowserContext, box: Sandbox, role: Role): Promise<void> =>
  context.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [AUTH_KEY, box.sessions[role]] as const,
  );

/**
 * Песочница на весь обход: свой проект и СВОИ люди.
 *
 * Свои люди здесь не перестраховка. Обход жмёт у креатора тумблер
 * «занят», а это отметка человека, а не проекта: на общем креаторе она
 * оставалась после прогона и ломала сбор заказа в order-roster — через
 * два файла и без единой подсказки в отчёте.
 */
let box: Sandbox;

test.beforeAll(async () => {
  box = await createSandbox(`sweep${String(Date.now()).slice(-5)}`, {
    shape: 'stats',
    ownCreator: true,
    ownClient: true,
  });
});

test.afterAll(() => dropSandbox(box));

for (const role of ['client', 'creator', 'manager', 'admin'] as const) {
  test(`кнопки ${role}: ни одной мёртвой и ни одной ошибки отрисовки`, async ({
    context,
    page,
  }) => {
    // Обход медленный по природе: на каждую кнопку перезагрузка экрана.
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${e}`));
    await signIn(context, box, role);

    const dead: Finding[] = [];
    const blocked: Finding[] = [];
    const shifted: Finding[] = [];
    const skipped: Finding[] = [];
    let found = 0;
    let pressed = 0;
    for (const screen of screens(role, box)) {
      const one = await sweep(page, screen, dead, blocked, shifted, skipped);
      found += one.found;
      pressed += one.pressed;
    }

    expect(found, 'на экранах роли вообще нашлись кнопки').toBeGreaterThan(0);
    // Разбор обхода одной строкой. Он нужен ОБОИМ требованиям ниже:
    // и «счёт сошёлся», и «нажали большую часть» падают одинаково
    // невнятно — числом без имён, — а причина у них одна и та же, и
    // читать её приходится в отчёте, где кнопку уже не потрогать.
    const list = (items: Finding[]): string =>
      items.map((x) => `${x.screen} → «${x.label}»: ${x.why}`).join('; ');
    const breakdown =
      `нашли ${found}, нажали ${pressed}` +
      `, пропустили ${skipped.length} (${list(skipped)})` +
      `, не дотянулись ${blocked.length} (${list(blocked)})` +
      `, уехало ${shifted.length} (${list(shifted)})`;
    // Самая тихая дыра прежнего обхода: считались НАЙДЕННЫЕ кнопки, а не
    // нажатые, и «ни одной мёртвой» могло означать «ни одной не нажали».
    // Теперь счётчик отдельный, и на него есть требование.
    const accounted = pressed + skipped.length + blocked.length + shifted.length;
    expect(accounted, breakdown).toBe(found);
    // И отдельно — что нажали заметно больше, чем пропустили: обход,
    // который всё пропустил, тоже «сошёлся бы».
    expect(pressed, breakdown).toBeGreaterThan(found * 0.8);
    expect(
      shifted.map((s) => `${s.screen} → «${s.label}»: ${s.why}`),
      'кнопка уехала со своего места между проходами — под чужой подписью её жать нельзя',
    ).toEqual([]);
    expect(
      errors,
      'отрисовка не падала: одна такая ошибка гасит все кнопки страницы разом',
    ).toEqual([]);
    expect(
      blocked.map((b) => `${b.screen} → «${b.label}»: ${b.why}`),
      'до кнопки нельзя дотянуться: её перекрыли или она не стоит на месте',
    ).toEqual([]);
    expect(
      dead.map((d) => `${d.screen} → «${d.label}»${d.why ? `: ${d.why}` : ''}`),
      'после нажатия ничего не произошло — ни нового запроса, ни смены адреса, ни правки разметки',
    ).toEqual([]);
  });
}

/**
 * Проверка самого обхода: он обязан ловить заведомо мёртвую кнопку.
 *
 * Обход, который никогда не краснеет, хуже отсутствующего: он выдаёт
 * молчание за проверку. А замолчать он умеет тихо — и именно так и
 * молчал. «Что-то произошло» определялось флагом, который поднимал ЛЮБОЙ
 * запрос за 700 мс: на экране с фоновым опросом мёртвая кнопка
 * засчитывалась живой, потому что рядом сходил чужой GET.
 *
 * Поэтому подкладываем на настоящий экран настоящую мёртвую кнопку — без
 * обработчика, без адреса, без последствий — и требуем, чтобы обход её
 * назвал. Экран берём самый шумный: карточка проекта тянет данные
 * вкладками и перерисовывается сама.
 */
const injectDead = (context: BrowserContext, labels: string[]): Promise<void> =>
  context.addInitScript(
    ([names, api]: [string[], string]) => {
      const add = (): void => {
        if (document.getElementById('e2e-dead')) return;
        const holder = document.createElement('div');
        holder.id = 'e2e-dead';
        for (const name of names) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = name;
          holder.appendChild(b);
        }
        document.body.appendChild(holder);
      };
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', add);
      } else {
        add();
      }
      // Фоновый опрос — тот самый шум, на котором обход и обманывался.
      // Настоящие экраны опрашивают сервер раз в тридцать секунд, и
      // попасть в семисотмиллисекундное окно нажатия у них выходит раз
      // на полсотни кнопок: поймать это случайно нельзя, а поломка от
      // этого не перестаёт быть поломкой. Поэтому шумим НАМЕРЕННО и
      // часто — так проверка становится воспроизводимой.
      setInterval(() => {
        void fetch(`${api}/api/v1/categories`).catch(() => undefined);
      }, 150);
    },
    [labels, API] as [string[], string],
  );

test('обход ловит мёртвую кнопку на экране, который шумит сам', async ({ context, page }) => {
  test.setTimeout(300_000);
  await signIn(context, box, 'manager');
  await injectDead(context, ['Кнопка без обработчика']);

  const dead: Finding[] = [];
  const blocked: Finding[] = [];
  const shifted: Finding[] = [];
  const skipped: Finding[] = [];
  const one = await sweep(
    page,
    { url: `/manager/projects/${box.projectId}` },
    dead,
    blocked,
    shifted,
    skipped,
  );

  expect(one.pressed, 'кнопки на экране нашлись и нажались').toBeGreaterThan(1);
  expect(
    dead.map((d) => d.label),
    'мёртвая кнопка названа, и названа только она',
  ).toEqual(['Кнопка без обработчика']);
});

/**
 * И вторая проверка обхода: одинаковые подписи он не схлопывает в одну.
 *
 * Схлопывал: из двадцати кнопок «Открыть» жалась первая, а мёртвая
 * девятнадцатая проезжала молча. Теперь из каждой группы берутся три —
 * первая, средняя и последняя, — и это здесь и проверяется: пять
 * одинаковых мёртвых кнопок обязаны дать три находки, а не одну.
 */
test('обход не схлопывает одинаковые подписи в одну', async ({ context, page }) => {
  test.setTimeout(300_000);
  await signIn(context, box, 'manager');
  await injectDead(
    context,
    Array.from({ length: 5 }, () => 'Открыть'),
  );

  const dead: Finding[] = [];
  const blocked: Finding[] = [];
  const shifted: Finding[] = [];
  const skipped: Finding[] = [];
  await sweep(page, { url: `/manager/projects/${box.projectId}` }, dead, blocked, shifted, skipped);

  expect(
    dead.filter((d) => d.label === 'Открыть').length,
    'из пяти одинаковых кнопок проверены три: первая, средняя и последняя',
  ).toBe(SAME_LABEL_LIMIT);
});

/**
 * Третья проверка обхода: отпечаток экрана не должен быть слепым к
 * правке в хвосте страницы.
 *
 * Прежний отпечаток складывался из длины `innerHTML` и ПЕРВЫХ ЧЕТЫРЁХ
 * ТЫСЯЧ знаков `innerText`. Кнопка, меняющая текст дальше, при
 * неизменившейся длине разметки не оставляла следа вовсе — и живая
 * кнопка объявлялась мёртвой. Это не гипотеза: половина экранов CRM
 * длиннее четырёх тысяч знаков, а правка «внизу таблицы» — обычное дело.
 *
 * Подкладываем ровно такую кнопку: она меняет один знак на пятитысячной
 * позиции, не трогая ни длину текста, ни длину разметки. Обход обязан
 * увидеть, что что-то произошло.
 */
const injectDeepChange = (context: BrowserContext): Promise<void> =>
  context.addInitScript(() => {
    const add = (): void => {
      if (document.getElementById('e2e-deep')) return;
      const holder = document.createElement('div');
      holder.id = 'e2e-deep';
      const filler = document.createElement('p');
      filler.textContent = 'ф'.repeat(6000);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Правит хвост страницы';
      button.addEventListener('click', () => {
        const was = filler.textContent ?? '';
        filler.textContent = `${was.slice(0, 5000)}я${was.slice(5001)}`;
      });
      holder.appendChild(filler);
      holder.appendChild(button);
      document.body.appendChild(holder);
    };
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', add);
    } else {
      add();
    }
  });

test('обход видит правку в хвосте страницы, а не только в первом экране', async ({
  context,
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(context, box, 'manager');
  await injectDeepChange(context);

  const dead: Finding[] = [];
  const blocked: Finding[] = [];
  const shifted: Finding[] = [];
  const skipped: Finding[] = [];
  await sweep(page, { url: `/manager/projects/${box.projectId}` }, dead, blocked, shifted, skipped);

  expect(
    dead.map((d) => d.label),
    'кнопка меняет текст на 5000-м знаке — это след, и обход обязан его увидеть',
  ).not.toContain('Правит хвост страницы');
});

/**
 * Команды редактора комментария — единственные, что обход жмёт не сам.
 *
 * Без выделенного текста «Ж» и «К» не должны делать ничего, и это не
 * поломка: команда применяется к выделению. Обход такую кнопку объявил
 * бы мёртвой, поэтому здесь она проверяется по-настоящему — с текстом,
 * выделением и разметкой на выходе.
 */
test('команды редактора комментария применяются к выделенному тексту', async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(context, box, 'manager');
  await page.goto(`/manager/projects/${box.projectId}`);
  await openManagerTab(page, 'Комментарии');

  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor, 'у комментариев есть чем набрать текст').toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.type('жирное слово');
  await page.keyboard.press('ControlOrMeta+a');

  const before = await editor.innerHTML();
  await page.locator('button', { hasText: /^B$/ }).first().click();
  await expect
    .poll(() => editor.innerHTML(), {
      timeout: 5000,
      message: 'полужирное не применилось к выделенному тексту',
    })
    .not.toBe(before);
  expect(await editor.innerHTML(), 'в разметке появилось начертание').toMatch(/<(b|strong)[ >]/i);
});
