import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { request } from '@playwright/test';

/**
 * Подготовка мира для браузерных тестов.
 *
 * Делится надвое намеренно. Пользователи заводятся SQL'ем — войти иначе
 * нечем: регистрация требует подтверждения почты, а письма локально
 * никуда не уходят. Всё остальное — проект, состав, тариф, выкладки —
 * собирается через настоящее API теми же запросами, что шлёт интерфейс.
 * Разложить проект по таблицам было бы быстрее и бесполезнее: тест
 * проверял бы вёрстку поверх состояния, которого приложение не создаёт.
 */

// __dirname, а не import.meta: пакет фронта — CommonJS.
const here = __dirname;
const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';
const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'marketplace-api-postgres-1';
const REDIS_CONTAINER = process.env.E2E_REDIS_CONTAINER ?? 'marketplace-api-redis-1';
const PG_USER = process.env.E2E_PG_USER ?? 'marketpclce';
const PG_DB = process.env.E2E_PG_DB ?? 'marketpclce';
const PASSWORD = 'E2ePassw0rd!';

/** Куда кладём готовый мир: специи читают его отсюда. */
export const statePath = join(here, '..', '.state', 'world.json');

export interface World {
  projectId: string;
  publicationId: string;
  /**
   * Проект, в котором не вышло ни одного ролика.
   *
   * Периодов у него нет вовсе: отсчёт начинается с первой публикации.
   * Денежная ручка отвечает на него отказом, а список периодов — пустым
   * списком, и это состояние, а не сбой.
   */
  emptyProjectId: string;
  /**
   * Проект с прошлым: период 1 подытожен, период 2 идёт.
   *
   * Подытог руками не делается — его через две недели после конца
   * периода ставит воркер, и дождаться этого браузером нельзя: время не
   * перемотать. Поэтому подытоженный период кладётся данными, а проверяется
   * то, что видит человек: пометка «Данные приблизительные», подписи
   * датами и переоткрытие админом.
   */
  historyProjectId: string;
  sessions: Record<'manager' | 'creator' | 'client' | 'admin', Session>;
}

export interface Session {
  access_token: string;
  refresh_token: string;
}

/**
 * Прогнать произвольный SQL в dev-базу через контейнер.
 *
 * Экспортирован ради одного: привязать заказ к проекту. HTTP-ручки для
 * этого нет — проект после оплаты заводит менеджер руками, и связь
 * проставляется внутри. Остальное специи по-прежнему делают настоящим
 * API.
 */
export function psql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', '-i', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB, '-v', 'ON_ERROR_STOP=1'],
    { input: sql, stdio: ['pipe', 'ignore', 'inherit'] },
  );
}

/**
 * Сбросить счётчики рейт-лимитера.
 *
 * Полный прогон делает по одной ручке проекта больше запросов, чем
 * укладывается в часовое окно локального лимитера, и хвост специй ловит
 * 429. Падение при этом выглядит как «элемент не найден»: страница просто
 * не нарисовалась. Чистим перед прогоном — ключи живут только локально.
 */
function resetRateLimits(): void {
  try {
    execFileSync(
      'docker',
      [
        'exec',
        REDIS_CONTAINER,
        'redis-cli',
        'eval',
        "local k=redis.call('keys','rl:*'); for i=1,#k do redis.call('del',k[i]) end; return #k",
        '0',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
  } catch {
    // Redis может быть не поднят — тогда лимитер и не считает. Это не
    // повод не запускать тесты.
  }
}

/**
 * Цифры по площадкам. Единственное, что кладём в базу мимо приложения:
 * их собирает instacurl, ходящий в TikTok, Instagram, YouTube, VK и
 * Likee. Поднимать пять внешних площадок ради теста бессмысленно, а всё,
 * что идёт ПОСЛЕ сбора — графики, доли площадок, бонусы, — проверяется
 * полностью.
 *
 * Числа подобраны так, чтобы каждое было различимо на экране:
 * вчера 2 000 000 просмотров, сегодня 3 000 000, прирост ровно миллион.
 * Репосты не кладём намеренно: площадки отдают их не все, и ER, посчитанный
 * без них, — штатное состояние, которое интерфейс обязан помечать.
 */
export const STATS = {
  yesterday: { tiktok: 1_400_000, instagram: 300_000, youtube: 200_000, vk: 80_000, likee: 20_000 },
  today: { tiktok: 2_000_000, instagram: 500_000, youtube: 300_000, vk: 150_000, likee: 50_000 },
  likes: { tiktok: 60_000, instagram: 15_000, youtube: 9_000, vk: 4_500, likee: 1_500 },
  comments: { tiktok: 6_000, instagram: 1_500, youtube: 900, vk: 450, likee: 150 },
  totalToday: 3_000_000,
  totalYesterday: 2_000_000,
  growth: 1_000_000,
} as const;

function caseBy(map: Record<string, number>): string {
  const arms = Object.entries(map)
    .map(([platform, value]) => `WHEN '${platform}' THEN ${value}`)
    .join(' ');
  return `CASE l.platform ${arms} ELSE 0 END`;
}

function seedStats(publicationId: string): void {
  psql(`
DELETE FROM video_stat_daily WHERE link_id IN
  (SELECT id FROM publication_links WHERE publication_id = '${publicationId}');

-- Дату выхода ставит сборщик — он же кладёт и снимки. Раз снимки мы
-- подменяем, дату обязаны положить тем же посевом: без неё у ролика нет
-- возраста, а на возрасте стоит и «зрелый» (14 дней), и шкала ступеней
-- у креатора, которая без даты считала бы ролик невышедшим.
UPDATE publication_links SET published_at = now() - interval '1 day'
WHERE publication_id = '${publicationId}';

INSERT INTO video_stat_daily (link_id, stat_date, views, likes, comments, collected_at)
SELECT l.id, CURRENT_DATE - 1, ${caseBy(STATS.yesterday)},
       ${caseBy(STATS.likes)} / 2, ${caseBy(STATS.comments)} / 2, now() - interval '1 day'
FROM publication_links l WHERE l.publication_id = '${publicationId}';

INSERT INTO video_stat_daily (link_id, stat_date, views, likes, comments, collected_at)
SELECT l.id, CURRENT_DATE, ${caseBy(STATS.today)},
       ${caseBy(STATS.likes)}, ${caseBy(STATS.comments)}, now()
FROM publication_links l WHERE l.publication_id = '${publicationId}';
`);
}

/**
 * Через сколько дней назад вышли ролики проекта с прошлым.
 *
 * Десять первых попадают в период 1 — он длится месяц от даты первого
 * ролика, — последний в период 2, который идёт сейчас. Числа выбраны с
 * запасом: даже когда в периоде 28 дней, он кончается позже, чем −27, а
 * −3 заведомо остаётся в следующем.
 *
 * Десять — не круглое число ради красоты: ровно с такой своей историей
 * сервер перестаёт звать типичным роликом средний по площадке и начинает
 * считать его по роликам самого креатора. Меньше — и подпись под шкалой
 * никогда не доходила бы до ветки «по твоим роликам».
 */
export const HISTORY_AGES = [45, 43, 41, 39, 37, 35, 33, 31, 29, 27, 3] as const;

/** Сколько просмотров кладём каждой площадке зрелого ролика. */
const HISTORY_VIEWS = 400_000;

/**
 * Пять ссылок на один ролик: выкладка считается сданной, только когда
 * закрыты все площадки, а от статуса зависят и вычет за недосданное, и
 * состав периода.
 */
function historyLinks(tag: string): string[] {
  return [
    `https://www.tiktok.com/@nastya/video/741209${tag}`,
    `https://www.instagram.com/reel/C9xK2mLpQ${tag}/`,
    `https://www.youtube.com/shorts/kQ2Vn8pLx${tag}`,
    `https://vk.com/clip-2394821_456${tag}`,
    `https://likee.video/@nastya/video/741209${tag}`,
  ];
}

/**
 * Отодвинуть выход роликов в прошлое и стереть выведенные из них периоды.
 *
 * Дату выхода ставит сборщик, а границы периодов сервер выводит из неё
 * же — значит подменять надо дату, а не границы: иначе тест проверял бы
 * разметку поверх состояния, которого приложение не создаёт.
 *
 * Периоды сносим по одному с хвоста: каждый следующий ссылается на
 * предыдущий, и удаление пачкой упирается в этот же внешний ключ.
 */
function backdateHistory(projectId: string): void {
  psql(`
UPDATE publication_links l SET published_at = p.due_date
FROM project_publications p
WHERE p.id = l.publication_id AND p.project_id = '${projectId}';

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM project_periods WHERE project_id = '${projectId}' ORDER BY seq DESC LOOP
    DELETE FROM project_periods WHERE id = r.id;
  END LOOP;
END $$;
`);
}

/**
 * Сколько дней подряд собраны цифры проекта с прошлым.
 *
 * Больше недели — и это не запас: переключатель глубины графика
 * показывается, только когда «7 дней» и «30 дней» рисуют разные картинки.
 * На ряде короче восьми дней обе кнопки дают одно и то же, и их
 * правильно не показывать — но тогда и проверять нечего.
 */
export const HISTORY_DAYS = 20;

/**
 * Цифры для роликов проекта с прошлым: ряд по дням, ровный и растущий.
 *
 * Ряд накопительный, как его и отдаёт сборщик: каждый следующий день не
 * меньше предыдущего. Последний день — те же {@link HISTORY_VIEWS} на
 * площадку, что лежат в срезе подытоженного периода: разъедься они, и
 * «сколько сейчас» на шкале креатора разошлось бы со счётом ступеней.
 */
function seedHistoryStats(projectId: string): void {
  psql(`
DELETE FROM video_stat_daily WHERE link_id IN
  (SELECT l.id FROM publication_links l
   JOIN project_publications p ON p.id = l.publication_id
   WHERE p.project_id = '${projectId}');

INSERT INTO video_stat_daily (link_id, stat_date, views, likes, comments, collected_at)
SELECT l.id,
       CURRENT_DATE - d,
       ${HISTORY_VIEWS} - d * (${HISTORY_VIEWS} / ${HISTORY_DAYS}),
       (${HISTORY_VIEWS} - d * (${HISTORY_VIEWS} / ${HISTORY_DAYS})) / 30,
       (${HISTORY_VIEWS} - d * (${HISTORY_VIEWS} / ${HISTORY_DAYS})) / 300,
       now() - make_interval(days => d)
FROM publication_links l
JOIN project_publications p ON p.id = l.publication_id
CROSS JOIN generate_series(0, ${HISTORY_DAYS} - 1) AS d
WHERE p.project_id = '${projectId}';
`);
}

/**
 * Подытожить первый период проекта, оставив срез приблизительным.
 *
 * Подытог ставит воркер через две недели после конца периода, и
 * дождаться его браузером нельзя — время не перемотать. Поэтому
 * состояние кладётся данными: снимок по площадкам, дата среза и пометка
 * «поденной статистики за период уже нет». Проверяется при этом не
 * подытог, а то, что видит человек.
 *
 * Идемпотентна и вызывается перед каждым прогоном: спека на
 * переоткрытие оставляет период открытым, и следующему прогону нужен
 * снова подытоженный.
 */
export function lockFirstPeriod(projectId: string): void {
  psql(`
WITH per AS (SELECT id, starts_on, ends_on FROM project_periods
             WHERE project_id = '${projectId}' AND seq = 1)
INSERT INTO project_period_publications (period_id, publication_id, creator_user_id, status, published_on)
SELECT per.id, p.id, p.creator_user_id, p.status, MIN(l.published_at)::date
FROM per
JOIN project_publications p ON p.project_id = '${projectId}'
JOIN publication_links l ON l.publication_id = p.id
GROUP BY per.id, p.id, p.creator_user_id, p.status, per.starts_on, per.ends_on
HAVING MIN(l.published_at)::date BETWEEN per.starts_on AND per.ends_on
ON CONFLICT DO NOTHING;

WITH per AS (SELECT id, ends_on FROM project_periods
             WHERE project_id = '${projectId}' AND seq = 1)
INSERT INTO project_period_views
  (period_id, publication_id, platform, link_id, views, likes, comments, stat_date, published_at)
SELECT per.id, l.publication_id, l.platform, l.id,
       ${HISTORY_VIEWS}, ${HISTORY_VIEWS} / 30, ${HISTORY_VIEWS} / 300,
       per.ends_on + 14, l.published_at
FROM per
JOIN project_period_publications pp ON pp.period_id = per.id
JOIN publication_links l ON l.publication_id = pp.publication_id
ON CONFLICT DO NOTHING;

UPDATE project_periods
   SET status = 'locked', locked_at = now(),
       snapshot_as_of = ends_on + 14, snapshot_approx = TRUE
 WHERE project_id = '${projectId}' AND seq = 1;
`);
}

function seedUsers(): void {
  const sql = readFileSync(join(here, '..', 'seed', 'users.sql'), 'utf8');
  // psql внутри контейнера: снаружи клиента может не быть, а контейнер
  // и так поднят для разработки.
  execFileSync(
    'docker',
    ['exec', '-i', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB, '-v', 'ON_ERROR_STOP=1'],
    {
      input: sql,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

/**
 * Токены прошлого прогона, если они ещё живые.
 *
 * Вход защищён лимитером, и это правильно: подбор пароля должен упираться
 * в 429. Но прогон за прогоном логиниться четырьмя пользователями значит
 * добровольно ловить эту защиту и падать не по делу. Поэтому сперва
 * пробуем то, что уже есть, и логинимся только когда просрочилось.
 */
async function reuseSessions(
  api: Awaited<ReturnType<typeof request.newContext>>,
): Promise<World['sessions'] | null> {
  if (!existsSync(statePath)) return null;
  try {
    const prev = JSON.parse(readFileSync(statePath, 'utf8')) as World;
    for (const s of Object.values(prev.sessions)) {
      const res = await api.get('/api/v1/me', {
        headers: { Authorization: `Bearer ${s.access_token}` },
      });
      if (!res.ok()) return null;
    }
    return prev.sessions;
  } catch {
    return null;
  }
}

export default async function globalSetup(): Promise<void> {
  resetRateLimits();
  const api0 = await request.newContext({ baseURL: API });
  const reused = await reuseSessions(api0);
  await api0.dispose();

  // Пересевать пользователей, когда сессии живы, нельзя: посев их
  // удаляет и заводит заново, и старые токены разом протухнут.
  if (!reused) seedUsers();

  const api = await request.newContext({ baseURL: API });
  const login = async (email: string): Promise<Session> => {
    const res = await api.post('/api/v1/auth/login', {
      data: { login: email, password: PASSWORD },
    });
    if (!res.ok()) {
      throw new Error(`вход ${email}: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as Session;
  };

  const sessions = reused ?? {
    manager: await login('e2e-manager@example.com'),
    creator: await login('e2e-creator@example.com'),
    client: await login('e2e-client@example.com'),
    admin: await login('e2e-admin@example.com'),
  };

  const auth = (s: Session) => ({ Authorization: `Bearer ${s.access_token}` });

  // Проект прошлого прогона переиспользуем, если он цел.
  //
  // Раньше его сносили и заводили заново ВСЕГДА — ради того, чтобы не
  // копились одинаковые «PetFlat · UGC (e2e)». Цена оказалась выше
  // пользы: открытая в браузере страница проекта после любого прогона
  // указывала на удалённую запись, и на любое действие сервер честно
  // отвечал «проект не найден». Смотреть на стенд и одновременно гонять
  // тесты стало нельзя.
  //
  // Теперь пересобираем, только если мир перестал быть пригодным:
  // проект пропал, потерял состав или посеянная выкладка больше не
  // сдана целиком. Лишние строки, заведённые тестами или руками, не
  // мешают — специи смотрят на посеянную.
  const reusableWorld = await (async (): Promise<World | null> => {
    if (!existsSync(statePath)) return null;
    let saved: World;
    try {
      saved = JSON.parse(readFileSync(statePath, 'utf8')) as World;
    } catch {
      return null;
    }
    if (!saved.projectId || !saved.publicationId) return null;
    if (!saved.emptyProjectId || !saved.historyProjectId) return null;

    const pubs = await api.get(`/api/v1/manager/projects/${saved.projectId}/publications`, {
      headers: auth(sessions.manager),
    });
    if (!pubs.ok()) return null;
    const items = ((await pubs.json()).items ?? []) as {
      id: string;
      status: string;
      links?: unknown[];
    }[];
    // Лишние выкладки не мешают: специи смотрят на посеянную, а не на
    // «ровно одну». Если требовать точное совпадение, любая заведённая
    // руками строка заставляет пересобрать мир — и снова сносит проект
    // под открытой страницей.
    const seeded = items.find((p) => p.id === saved.publicationId);
    if (!seeded || seeded.status !== 'done') return null;
    if ((seeded.links?.length ?? 0) !== 5) return null;

    const crew = await api.get(`/api/v1/manager/projects/${saved.projectId}/creators`, {
      headers: auth(sessions.manager),
    });
    if (!crew.ok() || ((await crew.json()).items ?? []).length === 0) return null;

    // Проект без публикаций и проект с прошлым живут своей жизнью, но
    // без них половина денежных специй проверять нечего.
    const empty = await api.get(`/api/v1/manager/projects/${saved.emptyProjectId}`, {
      headers: auth(sessions.manager),
    });
    if (!empty.ok()) return null;
    const periods = await api.get(
      `/api/v1/manager/projects/${saved.historyProjectId}/billing/periods`,
      { headers: auth(sessions.manager) },
    );
    if (!periods.ok()) return null;
    if (((await periods.json()).items ?? []).length < 2) return null;

    // Цифры кладём заново: они дешёвые, а прошлый прогон мог их сдвинуть.
    seedStats(saved.publicationId);
    seedHistoryStats(saved.historyProjectId);
    // И подытог возвращаем на место: спека на переоткрытие оставляет
    // период открытым, а следующему прогону он нужен подытоженным.
    lockFirstPeriod(saved.historyProjectId);
    return { ...saved, sessions };
  })();

  if (reusableWorld) {
    writeFileSync(statePath, JSON.stringify(reusableWorld, null, 2));
    await api.dispose();
    return;
  }

  // Собираем мир заново — и вот теперь чистим за прошлым прогоном.
  psql(`
DELETE FROM outbox WHERE aggregate = 'project' AND aggregate_id IN (
  SELECT p.id::text FROM projects p
  JOIN users u ON u.id = p.client_user_id
  WHERE u.email = 'e2e-client@example.com');
DELETE FROM projects WHERE client_user_id IN
  (SELECT id FROM users WHERE email = 'e2e-client@example.com');
`);
  const call = async (
    method: 'get' | 'post' | 'put',
    path: string,
    s: Session,
    data?: unknown,
    expect = 200,
  ): Promise<any> => {
    const res = await api[method](path, { headers: auth(s), data: data ?? undefined });
    if (res.status() !== expect) {
      throw new Error(`${method.toUpperCase()} ${path}: ${res.status()} ${await res.text()}`);
    }
    return res.status() === 204 ? null : await res.json();
  };

  const me = await call('get', '/api/v1/me', sessions.client);
  const creatorMe = await call('get', '/api/v1/me', sessions.creator);

  // Проект с креаторами: воронки у него нет, вид задаётся явно.
  const project = await call(
    'post',
    '/api/v1/manager/projects',
    sessions.manager,
    {
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC (e2e)',
      client_user_id: me.user_id,
      notes: 'Вертикальные ролики про корм для кошек',
    },
    201,
  );

  await call(
    'post',
    `/api/v1/manager/projects/${project.id}/creators`,
    sessions.manager,
    { creator_user_id: creatorMe.user_id },
    204,
  );
  await call('post', `/api/v1/manager/projects/${project.id}/billing/adopt`, sessions.manager);

  const today = new Date().toISOString().slice(0, 10);
  const batch = await call(
    'post',
    `/api/v1/manager/projects/${project.id}/publications/batch`,
    sessions.manager,
    { creator_user_ids: [creatorMe.user_id], dates: [today] },
    201,
  );

  // Креатор сдаёт ролик на все пять площадок — иначе статистике не к
  // чему привязаться: снимки живут на ссылках, а не на выкладке.
  const pubId = batch.items[0].id as string;
  await call('post', `/api/v1/me/creator/publications/${pubId}/links`, sessions.creator, {
    urls: [
      'https://www.tiktok.com/@nastya/video/7412093000',
      'https://www.instagram.com/reel/C9xK2mLpQ7v/',
      'https://www.youtube.com/shorts/kQ2Vn8pLxJc',
      'https://vk.com/clip-2394821_45623',
      'https://likee.video/@nastya/video/7412093000',
    ],
  });
  seedStats(pubId);

  /**
   * Завести ещё один проект заказчика с тем же креатором и тарифом.
   *
   * С пометкой «тест» — и это не украшение. Админский список показывает
   * двадцать строк, отсортированных от давно не двигавшихся, и посеянный
   * проект стоит в нём последним: он свежее всех. Каждая лишняя строка
   * выталкивает его на вторую страницу, и специя, которая открывает
   * проект кликом из списка, падает с «элемент не найден» — по причине,
   * не имеющей к ней никакого отношения. Пометка убирает эти проекты из
   * списка по умолчанию, а по делу они и есть тестовые.
   */
  const newProject = async (title: string, notes: string): Promise<string> => {
    const p = await call(
      'post',
      '/api/v1/manager/projects',
      sessions.manager,
      { kind: 'creators_turnkey', title, client_user_id: me.user_id, notes, is_test: true },
      201,
    );
    await call(
      'post',
      `/api/v1/manager/projects/${p.id}/creators`,
      sessions.manager,
      { creator_user_id: creatorMe.user_id },
      204,
    );
    await call('post', `/api/v1/manager/projects/${p.id}/billing/adopt`, sessions.manager);
    return p.id as string;
  };

  // Проект, в котором не вышло ни одного ролика: состав и тариф есть,
  // выкладок нет. Периода у него нет вовсе — считать не от чего.
  const emptyProjectId = await newProject(
    'PetFlat · без публикаций (e2e)',
    'Ещё не стартовали: дат выкладок нет',
  );

  // Проект с прошлым: три ролика, два из них в первом периоде.
  const historyProjectId = await newProject(
    'PetFlat · прошлые периоды (e2e)',
    'Идёт второй период, первый уже подытожен',
  );
  const day = (ago: number): string =>
    new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
  const historyBatch = await call(
    'post',
    `/api/v1/manager/projects/${historyProjectId}/publications/batch`,
    sessions.manager,
    { creator_user_ids: [creatorMe.user_id], dates: HISTORY_AGES.map(day) },
    201,
  );
  const historyPubs = (historyBatch.items ?? []) as { id: string; due_date: string }[];
  for (const [i, pub] of historyPubs.entries()) {
    await call('post', `/api/v1/me/creator/publications/${pub.id}/links`, sessions.creator, {
      urls: historyLinks(String(i + 1).padStart(2, '0')),
    });
  }
  // Сдача ссылок ставит датой выхода сегодня — отодвигаем её к плановой
  // дате, иначе все три ролика окажутся в одном сегодняшнем периоде.
  // Периоды сервер выведет заново при первом же запросе.
  backdateHistory(historyProjectId);
  seedHistoryStats(historyProjectId);
  await call(
    'get',
    `/api/v1/manager/projects/${historyProjectId}/billing/periods`,
    sessions.manager,
  );
  lockFirstPeriod(historyProjectId);

  const world: World = {
    projectId: project.id,
    publicationId: pubId,
    emptyProjectId,
    historyProjectId,
    sessions,
  };
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(world, null, 2));
  await api.dispose();
}

/** Мир, подготовленный globalSetup. */
export function world(): World {
  return JSON.parse(readFileSync(statePath, 'utf8')) as World;
}

/**
 * Положить сессию в браузер до загрузки страницы.
 *
 * Ключ и форма совпадают с AuthSessionStore. Флаги роли не кладём
 * намеренно: приложение дочитывает их из /me, и подделывать их здесь
 * значило бы проверять интерфейс поверх состояния, которого при живом
 * входе не бывает.
 */
export const AUTH_KEY = 'marketpclce.auth.v1';
