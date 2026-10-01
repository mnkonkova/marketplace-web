import { execFileSync } from 'node:child_process';
import { request } from '@playwright/test';
import {
  HISTORY_AGES,
  SANDBOX_EMAIL_PREFIX,
  SANDBOX_MARK,
  backdateHistory,
  historyLinks,
  lockFirstPeriod,
  psql,
  resetRateLimits,
  seedHistoryStats,
  seedPublicationStats,
  seedPublicationViewsFlat,
  world,
  type Session,
} from './world';

export { SANDBOX_EMAIL_PREFIX, SANDBOX_MARK, dropStaleSandboxes } from './world';

/**
 * Песочница: свой проект (а где нужно — и свои люди) на одну спеку.
 *
 * Раньше почти все специи работали на одном посеянном проекте, и мешали
 * они друг другу не теоретически. Обход кнопок жал у креатора «Занят в
 * этом месяце» — тумблер занятости, — и три теста в order-roster потом
 * падали с `creator_busy`: заказ не собирался, потому что общий креатор
 * отмечен занятым. Найти такую связь по отчёту нельзя: падает не та
 * спека, которая сломала.
 *
 * Отсюда правило: у спеки свой проект, заведённый настоящим API теми же
 * запросами, что шлёт интерфейс, и снесённый после — в `afterAll`,
 * который отрабатывает и когда тест упал. А там, где спека трогает
 * состояние ЧЕЛОВЕКА, а не проекта (занятость по месяцам, состав
 * кабинета, чеклисты), — и свои люди тоже.
 *
 * Как считается `creator_busy` (internal/orders: service.go → repo.go
 * BusyCreators): занятость НЕ выводится из выкладок. Это отдельная
 * отметка в `creator_availability`, которую креатор ставит сам —
 * `PUT /me/creator/availability`. Отсутствие строки означает «свободен».
 * Значит выкладки песочницы никого занятым не делают; занятым делает
 * ровно одно нажатие в кабинете креатора, и оно должно происходить на
 * своём человеке.
 */

const API = process.env.E2E_API ?? 'http://127.0.0.1:8080';
const PASSWORD = 'E2ePassw0rd!';

/**
 * Хеш пароля `E2ePassw0rd!` — тот же bcrypt, что в seed/users.sql.
 *
 * Считать его на месте нечем: bcrypt в зависимостях фронта нет, а тянуть
 * его ради посева пользователя — лишняя зависимость в тестах.
 */
const PASSWORD_HASH = '$2a$10$VLL7gXAlXcbWgcG/qthyKOU0Upz4iMk1.E1L9pQHkngMHaYwVXLFa';

export type Role = 'manager' | 'creator' | 'client' | 'admin';

const SHARED_EMAIL: Record<Role, string> = {
  manager: 'e2e-manager@example.com',
  creator: 'e2e-creator@example.com',
  client: 'e2e-client@example.com',
  admin: 'e2e-admin@example.com',
};

export interface SandboxUser {
  userId: string;
  email: string;
  /** Имя, которым человек подписан на экранах. */
  name: string;
  session: Session;
  /** Человек заведён этой песочницей и будет снесён вместе с ней. */
  own: boolean;
}

export interface Sandbox {
  tag: string;
  projectId: string;
  title: string;
  /** Бриф проекта: его показывает и карточка креатора, и карточка заказчика. */
  notes: string;
  /**
   * Выкладка, сданная на все пять площадок, с цифрами. Пусто у форм, где
   * выкладок нет вовсе.
   */
  publicationId: string;
  publicationIds: string[];
  /** Название сданного ролика — по нему его находят на экранах. */
  publicationTitle: string;
  creator: SandboxUser;
  /**
   * Все креаторы песочницы, первый — тот же, что `creator`.
   *
   * Второй и третий нужны подбору: заказ собирается из подборки в
   * порядке приоритета, и в ней должен быть резерв. Брать резерв из
   * общего каталога нельзя — тамошнего человека соседняя спека могла
   * отметить занятым, и заказ перестал бы создаваться по чужой причине.
   */
  creators: SandboxUser[];
  client: SandboxUser;
  manager: SandboxUser;
  admin: SandboxUser;
  /** Сессии для addInitScript — своя там, где человек свой. */
  sessions: Record<Role, Session>;
}

export type SandboxShape =
  /** Состав и тариф есть, выкладок нет: периода у проекта не начиналось. */
  | 'empty'
  /** Одна выкладка, сданная вчера на пять площадок, с цифрами STATS. */
  | 'stats'
  /** Одиннадцать выкладок: период 1 подытожен, период 2 идёт. */
  | 'history'
  /**
   * ДВОЕ в составе и разный вклад: у первого два скромных ролика, у
   * второго один залетевший.
   *
   * При одном креаторе правила раскладки неразличимы — любая доля равна
   * единице. Ошибка «разделили не по тому основанию» видна только когда
   * людей двое, и поэтому эта форма существует отдельно.
   */
  | 'crew';

export interface SandboxOptions {
  shape?: SandboxShape;
  /** Завести своего креатора: спека трогает состояние человека. */
  ownCreator?: boolean;
  /** Завести своего заказчика. */
  ownClient?: boolean;
  /**
   * Завести своего менеджера. По умолчанию да.
   *
   * Не про изоляцию проекта, а про изоляцию СПИСКОВ. Карточка проекта
   * показывает менеджеру все его проекты боковой колонкой, а «Мои
   * проекты» — таблицей. Общий e2e-менеджер собирает на себя всё, что
   * заведут соседи: двести нагрузочных строк превращали обход кнопок в
   * получасовой перебор чужих ссылок, а проверку «в списке одна строка»
   * — в неправду. Свой менеджер видит ровно свой проект.
   */
  ownManager?: boolean;
  /** Показывать ли проект в админском списке по умолчанию. */
  isTest?: boolean;
  /** Название проекта. Метка песочницы дописывается всегда. */
  title?: string;
  /** Бриф проекта. */
  notes?: string;
  /** Опубликовать своих креаторов в каталоге: нужно подбору в заказе. */
  inCatalog?: boolean;
  /** Сколько своих креаторов завести всего. По умолчанию один. */
  creators?: number;
}

// ---- транспорт ----

/**
 * Свежий токен роли.
 *
 * Токены мира живут полчаса, а прогон длиннее: песочница заводит проект,
 * ждёт пересчёта, жмёт подтверждения. На середине запросы начинали
 * отвечать «сессия истекла», и падение выглядело как поломка кнопки.
 */
const fresh = new Map<string, string>();

async function login(email: string): Promise<Session> {
  // Вход защищён лимитером (10/мин и 60/час на адрес), и это правильно.
  // Но посев песочниц логинится сам по себе, и упираться в защиту от
  // перебора паролей прогону незачем: чистим счётчики, как это делает
  // globalSetup перед прогоном.
  resetRateLimits();
  const api = await request.newContext({ baseURL: API });
  try {
    const res = await api.post('/api/v1/auth/login', {
      data: { login: email, password: PASSWORD },
    });
    if (!res.ok()) throw new Error(`вход ${email}: ${res.status()} ${await res.text()}`);
    return (await res.json()) as Session;
  } finally {
    await api.dispose();
  }
}

async function token(email: string, renew: boolean): Promise<string> {
  if (!renew) {
    const cached = fresh.get(email);
    if (cached) return cached;
  }
  const session = await login(email);
  fresh.set(email, session.access_token);
  return session.access_token;
}

async function once(
  email: string,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  data: unknown,
  renew: boolean,
): Promise<{ status: number; body: string | null }> {
  const api = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${await token(email, renew)}` },
  });
  try {
    const res = await api[method](path, { data: data ?? undefined });
    return { status: res.status(), body: res.status() === 204 ? null : await res.text() };
  } finally {
    await api.dispose();
  }
}

/**
 * Запрос от имени человека — по его адресу, а не по роли.
 *
 * Роль у песочницы может быть своя («её креатор»), а может быть общей, и
 * вызывающему эта разница безразлична: он называет человека.
 */
export async function callAs(
  who: SandboxUser | string,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  data?: unknown,
  expected: number[] = [200, 201, 204],
): Promise<any> {
  const email = typeof who === 'string' ? who : who.email;
  let res = await once(email, method, path, data, false);
  // Токен протух посреди прогона — входим заново и повторяем. Один раз:
  // второй отказ означает, что дело не в сроке жизни токена.
  if (res.status === 401) res = await once(email, method, path, data, true);
  if (!expected.includes(res.status)) {
    throw new Error(`${method.toUpperCase()} ${path}: ${res.status} ${res.body}`);
  }
  return res.body ? JSON.parse(res.body) : null;
}

/** Запрос от имени человека песочницы, названного ролью. */
export function call(
  box: Sandbox,
  role: Role,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  data?: unknown,
  expected?: number[],
): Promise<any> {
  return callAs(box[role], method, path, data, expected);
}

// ---- даты ----

/**
 * Полдень дня, отстоящего от сегодняшнего на `days`.
 *
 * Полдень, а не полночь: при переходе на летнее время сутки короче, и
 * арифметика от полуночи перепрыгивает день.
 */
export function dayAt(days: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * ГГГГ-ММ-ДД по МЕСТНОМУ календарю.
 *
 * Единственный помощник дат на все специи, и это не вкусовщина. Прежний
 * `day()` считал сдвиг местной арифметикой, а печатал через
 * `toISOString()` — то есть в UTC. В минусовых поясах `day(-1)` давал
 * сегодняшнее число, и «ролик вышел вчера» молча превращалось в «вышел
 * сегодня»: период не начинался, считать было нечего, а тест при этом
 * падал где-то в другом месте.
 */
export function ymd(value: number | Date): string {
  const d = typeof value === 'number' ? dayAt(value) : value;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Недавний день, но ОБЯЗАТЕЛЬНО этого месяца.
 *
 * Посев ставил вышедший ролик «вчера», и первого числа вчера — это уже
 * прошлый месяц. Календарь заказчика, окно простановки дат и шапка
 * проекта смотрят на ТЕКУЩИЙ месяц, и раз в месяц семь специй падали
 * разом: «мир обязан поставить выкладку в текущем месяце», «посеянный
 * ролик уже вышел», «нет свободного дня». Поломки при этом не было —
 * кончался месяц.
 *
 * Поэтому: вчера, но не раньше первого числа. На первое число ролик
 * садится на сегодня — он всё равно «вышел», цифры по нему сеются
 * отдельно (seedPublicationStats).
 */
export function recentThisMonth(daysAgo = 1): string {
  const now = new Date();
  const back = dayAt(-daysAgo);
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
  return ymd(back < first ? dayAt(0) : back);
}

/** Текущий месяц ГГГГ-ММ по местному календарю. */
export function ym(value: number | Date = 0): string {
  return ymd(value).slice(0, 7);
}

// ---- люди ----

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Завести человека песочницы SQL'ем.
 *
 * Тем же способом, что и общих: регистрация требует подтверждения почты,
 * а письма локально никуда не уходят. Всё остальное — проект, состав,
 * выкладки — по-прежнему собирается настоящим API.
 */
async function seedUser(
  tag: string,
  role: 'creator' | 'client' | 'manager',
  name: string,
  inCatalog: boolean,
  suffix = '',
): Promise<SandboxUser> {
  const email = `${SANDBOX_EMAIL_PREFIX}${tag}-${role}${suffix}@example.com`;
  const kind = role === 'creator' ? 'specialist' : 'client';
  const profile =
    role === 'creator'
      ? `
INSERT INTO specialist_profiles (user_id, display_name, is_published, social_links)
SELECT id, ${sqlText(name)}, ${inCatalog ? 'TRUE' : 'FALSE'},
       '{"tiktok":"https://tiktok.com/@sandbox"}'::jsonb
FROM users WHERE email = ${sqlText(email)}
ON CONFLICT (user_id) DO UPDATE SET is_published = EXCLUDED.is_published;

INSERT INTO specialist_categories (user_id, category_code, is_primary)
SELECT id, 'ugc', TRUE FROM users WHERE email = ${sqlText(email)}
ON CONFLICT DO NOTHING;
`
      : '';
  psql(`
INSERT INTO users (email, password_hash, kind, is_manager, is_admin,
                   is_approved, is_active, email_verified_at, display_name)
VALUES (${sqlText(email)}, '${PASSWORD_HASH}', '${kind}',
        ${role === 'manager' ? 'TRUE' : 'FALSE'}, FALSE, TRUE, TRUE, now(),
        ${sqlText(name)})
ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name;
${profile}`);

  const session = await login(email);
  fresh.set(email, session.access_token);
  const me = await callAs(email, 'get', '/api/v1/me');
  return { userId: me.user_id as string, email, name, session, own: true };
}

/** Общий человек мира: сессия уже есть, входить заново незачем. */
async function sharedUser(role: Role): Promise<SandboxUser> {
  const email = SHARED_EMAIL[role];
  const session = world().sessions[role];
  if (!fresh.has(email)) fresh.set(email, session.access_token);
  const me = await callAs(email, 'get', '/api/v1/me');
  return {
    userId: me.user_id as string,
    email,
    name: (me.display_name as string) ?? '',
    session,
    own: false,
  };
}

// ---- сборка ----

/**
 * Собрать песочницу.
 *
 * Всё, что умеет интерфейс, собирается его же запросами: проект, состав,
 * тариф, выкладки, сданные ссылки. SQL'ем кладём ровно две вещи —
 * людей (войти иначе нечем) и цифры площадок: их собирает сборщик,
 * ходящий в TikTok, Instagram, YouTube, VK и Likee, и поднимать пять
 * площадок ради теста бессмысленно. Всё, что идёт ПОСЛЕ сбора —
 * периоды, начисления, кнопки «Утвердить» и «Выплачено», — проверяется
 * целиком.
 */
export async function createSandbox(tag: string, opts: SandboxOptions = {}): Promise<Sandbox> {
  const shape = opts.shape ?? 'stats';
  const safeTag = tag.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24) || 'box';
  const title = `${opts.title ?? 'Песочница'} ${safeTag} ${SANDBOX_MARK}`;
  const notes = opts.notes ?? `Вертикальные ролики про корм для кошек (${safeTag})`;

  const wanted = Math.max(1, opts.creators ?? 1);
  const creators: SandboxUser[] = [];
  if (opts.ownCreator || wanted > 1) {
    for (let i = 0; i < wanted; i += 1) {
      creators.push(
        await seedUser(
          safeTag,
          'creator',
          `Креатор ${safeTag}-${i + 1}`,
          opts.inCatalog ?? false,
          String(i + 1),
        ),
      );
    }
  } else {
    creators.push(await sharedUser('creator'));
  }
  const creator = creators[0];
  const client = opts.ownClient
    ? await seedUser(safeTag, 'client', `Заказчик ${safeTag}`, false)
    : await sharedUser('client');
  const manager =
    opts.ownManager === false
      ? await sharedUser('manager')
      : await seedUser(safeTag, 'manager', `Менеджер ${safeTag}`, false);
  const admin = await sharedUser('admin');

  const box: Sandbox = {
    tag: safeTag,
    projectId: '',
    title,
    notes,
    publicationId: '',
    publicationIds: [],
    publicationTitle: `Ролик песочницы ${safeTag}`,
    creator,
    creators,
    client,
    manager,
    admin,
    sessions: {
      manager: manager.session,
      admin: admin.session,
      creator: creator.session,
      client: client.session,
    },
  };

  try {
    const project = await callAs(manager, 'post', '/api/v1/manager/projects', {
      kind: 'creators_turnkey',
      title,
      client_user_id: client.userId,
      notes,
      is_test: opts.isTest ?? true,
    });
    box.projectId = project.id as string;

    await callAs(manager, 'post', `/api/v1/manager/projects/${box.projectId}/creators`, {
      creator_user_id: creator.userId,
    });
    await callAs(manager, 'post', `/api/v1/manager/projects/${box.projectId}/billing/adopt`);

    if (shape === 'stats') await fillStats(box);
    if (shape === 'history') await fillHistory(box);
    if (shape === 'crew') await fillCrew(box);
    return box;
  } catch (err) {
    // Собралась наполовину — сносим целиком: полупроект в списках
    // соседних специй хуже отсутствующего.
    dropSandbox(box);
    throw err;
  }
}

/**
 * Обязательные пункты чеклиста проекта.
 *
 * Сдавая ролик, креатор их отмечает — без них сервер отвечает 422
 * checklist_incomplete, ровно как и живому человеку в интерфейсе.
 * Отмечаем ТОЛЬКО обязательные: необязательные и должны оставаться
 * пустыми, иначе специи про чеклист проверяли бы состояние, которого
 * сдача не создаёт.
 */
async function requiredChecklist(box: Sandbox): Promise<string[]> {
  const list = await callAs(
    box.creator,
    'get',
    `/api/v1/me/creator/projects/${box.projectId}/checklist`,
  );
  return ((list?.items ?? []) as { id: string; is_required: boolean }[])
    .filter((i) => i.is_required)
    .map((i) => i.id);
}

/** Одна выкладка, вышедшая вчера на пять площадок, и цифры по ней. */
async function fillStats(box: Sandbox): Promise<void> {
  const batch = await callAs(
    box.manager,
    'post',
    `/api/v1/manager/projects/${box.projectId}/publications/batch`,
    { creator_user_ids: [box.creator.userId], dates: [recentThisMonth()] },
  );
  const pubId = batch.items[0].id as string;
  box.publicationId = pubId;
  box.publicationIds = [pubId];
  await callAs(box.creator, 'post', `/api/v1/me/creator/publications/${pubId}/links`, {
    urls: platformLinks(box.tag),
    title: box.publicationTitle,
    checked_item_ids: await requiredChecklist(box),
  });
  seedPublicationStats(pubId);
}

/**
 * Двое в составе, разный вклад.
 *
 * Первый сдал два ролика по 200 000 просмотров, второй — один на
 * 3 000 000. Числа выбраны так, чтобы правила раскладки РАСХОДИЛИСЬ:
 * по роликам это две трети и треть, по просмотрам — 12% и 88%, а
 * сверх порога набрал только второй. Считать хвост и фикс одним
 * основанием после этого нельзя незаметно.
 */
async function fillCrew(box: Sandbox): Promise<void> {
  const second = box.creators[1];
  if (!second) throw new Error('форме crew нужны двое: createSandbox(..., { creators: 2 })');
  await callAs(box.manager, 'post', `/api/v1/manager/projects/${box.projectId}/creators`, {
    creator_user_id: second.userId,
  });

  const checked = await requiredChecklist(box);
  const submit = async (who: SandboxUser, day: string, mark: string, views: number) => {
    const batch = await callAs(
      box.manager,
      'post',
      `/api/v1/manager/projects/${box.projectId}/publications/batch`,
      { creator_user_ids: [who.userId], dates: [day] },
    );
    const pubId = batch.items[0].id as string;
    box.publicationIds.push(pubId);
    await callAs(who, 'post', `/api/v1/me/creator/publications/${pubId}/links`, {
      urls: platformLinks(`${box.tag}${mark}`),
      title: `${box.publicationTitle} ${mark}`,
      // Чеклист у проекта один на всех: пункты общие, отмечает их
      // каждый сдающий за себя.
      checked_item_ids: checked,
    });
    seedPublicationViewsFlat(pubId, views);
    return pubId;
  };

  // Здесь нужны три РАЗНЫХ дня, а не «обязательно этот месяц»: форма
  // про раскладку денег между людьми, и границы месяца ей безразличны.
  // Первого числа трёх прошедших дней внутри месяца не существует —
  // recentThisMonth() схлопнул бы их в один, и вторая пачка не создала
  // бы ничего (на день у креатора одна выкладка).
  await submit(box.creator, ymd(-3), 'a1', 200_000);
  await submit(box.creator, ymd(-2), 'a2', 200_000);
  box.publicationId = await submit(second, ymd(-1), 'b1', 3_000_000);
}

/** Одиннадцать выкладок: десять в первом периоде, одна во втором. */
async function fillHistory(box: Sandbox): Promise<void> {
  // Период спеки про подписи не должен начинаться первым числом — иначе
  // «сентябрь» оказался бы правдой и подмену даты стало бы нечем
  // поймать. Сдвигаем весь набор на день, сохраняя расстояния.
  const oldest = dayAt(-HISTORY_AGES[0]);
  const shift = oldest.getDate() === 1 ? 1 : 0;
  const dates = HISTORY_AGES.map((ago) => ymd(-(ago + shift)));
  const batch = await callAs(
    box.manager,
    'post',
    `/api/v1/manager/projects/${box.projectId}/publications/batch`,
    { creator_user_ids: [box.creator.userId], dates },
  );
  const items = (batch.items ?? []) as { id: string }[];
  box.publicationIds = items.map((p) => p.id);
  box.publicationId = items[items.length - 1]?.id ?? '';
  const checked = await requiredChecklist(box);
  for (const [i, pub] of items.entries()) {
    await callAs(box.creator, 'post', `/api/v1/me/creator/publications/${pub.id}/links`, {
      urls: historyLinks(`${box.tag}${String(i + 1).padStart(2, '0')}`),
      checked_item_ids: checked,
    });
  }
  // Сдача ссылок ставит датой выхода сегодня — отодвигаем её к плановой,
  // иначе все одиннадцать роликов окажутся в одном сегодняшнем периоде.
  backdateHistory(box.projectId);
  seedHistoryStats(box.projectId);
  // Границы периодов сервер выводит из дат выхода при первом же запросе.
  await callAs(box.manager, 'get', `/api/v1/manager/projects/${box.projectId}/billing/periods`);
  lockFirstPeriod(box.projectId);
  // Строка начисления за идущий период: без неё в кабинете креатора
  // стоит «посчитаем, когда по периоду пройдёт расчёт».
  await callAs(box.manager, 'post', `/api/v1/manager/projects/${box.projectId}/accruals/recalc`);
}

/** Пять ссылок на один ролик — выкладка сдана, только когда закрыты все. */
export function platformLinks(tag: string): string[] {
  return [
    `https://www.tiktok.com/@nastya/video/900${tag}`,
    `https://www.instagram.com/reel/C9sand${tag}/`,
    `https://www.youtube.com/shorts/sand${tag}`,
    `https://vk.com/clip-2394821_9${tag}`,
    `https://likee.video/@nastya/video/900${tag}`,
  ];
}

// ---- уборка ----

/**
 * Снести песочницу: проект, его следы в воркере и своих людей.
 *
 * Прямо в базе, а не ручкой удаления: ровно эту ручку и проверяет одна
 * из спек, и убирать за собой тем, что сейчас чинишь, — плохая идея.
 *
 * Зовётся из `afterAll`/`afterEach`, которые отрабатывают и после
 * падения теста. Пережить полусобранную песочницу тоже обязана: `box`
 * может прийти без проекта или не прийти вовсе.
 */
export function dropSandbox(box: Sandbox | null | undefined): void {
  if (!box) return;
  if (box.projectId) dropProject(box.projectId);
  for (const who of [...(box.creators ?? [box.creator]), box.client, box.manager]) {
    if (who?.own) dropUser(who.email);
  }
}

export function dropProject(projectId: string): void {
  psql(`
DELETE FROM video_stat_daily WHERE link_id IN (
  SELECT l.id FROM publication_links l
  JOIN project_publications p ON p.id = l.publication_id
  WHERE p.project_id = '${projectId}');
DELETE FROM outbox WHERE aggregate = 'project' AND aggregate_id = '${projectId}';
DELETE FROM creator_orders WHERE project_id = '${projectId}';
DELETE FROM projects WHERE id = '${projectId}';
`);
}

/**
 * Снести человека песочницы.
 *
 * Чужая строка, указывающая на него, держала бы его внешним ключом, и
 * удаление падало бы целиком. Обнуляем такие ссылки везде, где колонка
 * это позволяет, — список колонок берём из каталога, а не перечисляем
 * руками: перечисленный устаревает молча.
 */
export function dropUser(email: string): void {
  psql(`
DELETE FROM creator_orders WHERE client_user_id IN (SELECT id FROM users WHERE email = '${email}');
DELETE FROM projects WHERE client_user_id IN (SELECT id FROM users WHERE email = '${email}');
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND array_length(c.conkey, 1) = 1
          AND NOT a.attnotnull
          AND c.confdeltype IN ('a', 'r')
    LOOP
        EXECUTE format(
            'UPDATE %s SET %I = NULL WHERE %I IN (SELECT id FROM users WHERE email = %L)',
            r.tbl, r.col, r.col, '${email}');
    END LOOP;
END $$;
DELETE FROM users WHERE email = '${email}';
`);
}

/**
 * Что записалось в воркер по этому проекту.
 *
 * Воркер разбирает таблицу outbox: запись в неё и есть «событие
 * случилось». Смотрим в неё напрямую, потому что дальше начинается
 * доставка наружу, а проверять надо сперва сам факт записи — без него
 * доставлять нечего, и никакой бот об этом не узнает.
 */
export function outboxEvents(projectID: string): string[] {
  const out = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      process.env.E2E_PG_CONTAINER ?? 'marketplace-api-postgres-1',
      'psql',
      '-U',
      process.env.E2E_PG_USER ?? 'marketpclce',
      '-d',
      process.env.E2E_PG_DB ?? 'marketpclce',
      '-tAc',
      `SELECT event_type FROM outbox WHERE aggregate_id = '${projectID}' ORDER BY created_at`,
    ],
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
