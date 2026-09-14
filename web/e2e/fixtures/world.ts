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

    // Цифры кладём заново: они дешёвые, а прошлый прогон мог их сдвинуть.
    seedStats(saved.publicationId);
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

  const world: World = {
    projectId: project.id,
    publicationId: pubId,
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
