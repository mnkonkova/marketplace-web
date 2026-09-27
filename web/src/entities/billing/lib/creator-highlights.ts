import type { Platform, PlatformRow } from '@entities/publication/model/publication.types';

import type { Accrual, CreatorPeriod } from '../model/billing.types';
import type { LadderVideo } from './ladder';
import { periodDay, periodOf, periodTitle } from './period';

/**
 * Личные достижения креатора: чем он силён и как рос.
 *
 * Всё здесь — чистые функции над уже измеренными числами. Компонент
 * только раскладывает по экрану то, что посчитано тут, — иначе тест на
 * «упали ли просмотры» превращается в тест на то, что в карточке нужный
 * <b>.
 *
 * Денег здесь НЕ СЧИТАЮТ, как и в ladder.ts. Заработанное берётся из
 * начисления готовой суммой; складывать несколько готовых сумм можно —
 * это не расчёт тарифа, — а выводить их из ставок нельзя: вторая копия
 * расчёта разойдётся с серверной молча, и заметят это в день выплаты.
 *
 * И главное правило этого файла: плохое число остаётся плохим. Просмотры
 * упали — функция возвращает падение, а не молчание. Кабинет, который
 * умеет показывать только рост, перестают открывать ровно в тот месяц,
 * когда роста нет.
 */

// ---- ролики ----

/** Границы периода — всё, что нужно, чтобы отобрать его ролики. */
export interface PeriodBounds {
  starts_on: string;
  ends_on: string;
}

/**
 * Ролики, вышедшие внутри границ периода, включительно.
 *
 * «Вышел» — это published_at: ни дата сдачи ссылок, ни плановый срок
 * сюда не годятся (ссылки сдают и через неделю после выхода). Границы
 * берём у сервера и режем строки, а не строим Date: полночь UTC в
 * плюсовом поясе уезжает на сутки назад, и крайний ролик периода
 * попадал бы то в один период, то в другой.
 */
export function videosInPeriod(
  videos: LadderVideo[],
  period: PeriodBounds | null | undefined,
): LadderVideo[] {
  if (!period) return [];
  const from = period.starts_on.slice(0, 10);
  const to = period.ends_on.slice(0, 10);
  return videos.filter((v) => {
    const day = (v.published_at ?? '').slice(0, 10);
    return !!day && day >= from && day <= to;
  });
}

/**
 * Лучший ролик по просмотрам.
 *
 * null, когда лучшего нет: пустой список или везде нули. Ноль — это не
 * рекорд, и показывать «твой лучший ролик — 0 просмотров» значит
 * поздравлять с ничем.
 */
export function bestVideo(videos: LadderVideo[]): LadderVideo | null {
  let best: LadderVideo | null = null;
  for (const v of videos) {
    if (v.views > 0 && (!best || v.views > best.views)) best = v;
  }
  return best;
}

// ---- площадки ----

/**
 * Площадка в разрезе «сколько она даёт».
 *
 * Сравнивать площадки по сумме просмотров нельзя: один и тот же ролик
 * попадает не на все площадки сразу (часть площадок досылают, часть не
 * досылают вовсе), и площадка с шестью роликами обгонит площадку с
 * двумя просто числом роликов. Поэтому сравнение идёт по просмотрам НА
 * РОЛИК — это деление двух измеренных чисел, а не расчёт по тарифу.
 */
export interface PlatformStat {
  platform: Platform;
  videos: number;
  views: number;
  /** Просмотров на ролик. */
  perVideo: number;
  /** Доля от лучшей площадки — ширина полоски, 0..100. */
  percent: number;
}

/** Площадки с роликами, сильные первыми. Пустые в список не попадают. */
export function platformStats(rows: PlatformRow[] | null | undefined): PlatformStat[] {
  const withVideos = (rows ?? []).filter((r) => r.videos > 0 && r.views > 0);
  if (!withVideos.length) return [];
  const stats = withVideos
    .map((r) => ({
      platform: r.platform,
      videos: r.videos,
      views: r.views,
      perVideo: Math.round(r.views / r.videos),
      percent: 0,
    }))
    .sort((a, b) => b.perVideo - a.perVideo);
  const top = stats[0].perVideo;
  for (const s of stats) s.percent = top > 0 ? Math.round((s.perVideo / top) * 100) : 0;
  return stats;
}

/** Насколько сильнейшая площадка впереди остальных. */
export interface PlatformLead {
  best: PlatformStat;
  runnerUp: PlatformStat;
  /** Во сколько раз лучше следующей. */
  times: number;
}

/**
 * Насколько лидер должен обгонять вторую площадку, чтобы считаться
 * лидером.
 *
 * Четверть — потому что меньшая разница это разброс, а не сила: на
 * пяти-шести роликах площадки расходятся на десять процентов сами
 * собой. Назвать такую разницу преимуществом значит выдать случайность
 * за достижение — человек начнёт подстраивать работу под число,
 * которого нет.
 */
export const MIN_PLATFORM_LEAD = 1.25;

/**
 * Площадка, на которой он сильнее остальных.
 *
 * null, когда сравнивать не с чем (площадка одна) или когда первые две
 * идут вровень.
 */
export function platformLead(
  stats: PlatformStat[],
  minTimes: number = MIN_PLATFORM_LEAD,
): PlatformLead | null {
  if (stats.length < 2) return null;
  const [best, runnerUp] = stats;
  if (runnerUp.perVideo <= 0) return null;
  const times = best.perVideo / runnerUp.perVideo;
  if (times < minTimes) return null;
  return { best, runnerUp, times };
}

// ---- история периодов ----

/** Строка трудовой биографии: один период. */
export interface PeriodHistoryRow {
  id: string;
  /** «Период 2 · 15 сентября — 14 октября». Без периода — его дата. */
  title: string;
  periodStart: string;
  /** Период ещё идёт — числа изменятся. */
  open: boolean;
  total: number;
  salary: number;
  viewsBonus: number;
  /** Сколько сняли за недосданное. Ноль — не снимали. */
  deduction: number;
  views: number;
  videosDelivered: number;
  videosPlanned: number;
  /**
   * Просмотры к прошлому периоду. null — сравнивать не с чем: прошлого
   * периода нет либо один из двух ещё идёт. Идущий период против
   * законченного — сравнение половины с целым, и «просмотры упали» на
   * пятый день периода было бы неправдой.
   */
  viewsDelta: number | null;
  viewsDeltaPercent: number | null;
  /** Доля от лучшего периода по просмотрам — ширина полоски, 0..100. */
  barPercent: number;
}

/**
 * История периодов, свежие первыми.
 *
 * Начисления приходят по всем периодам сразу и знают только дату начала
 * своего периода; границы и состояние — в списке периодов. Достраивать
 * их прибавлением месяца нельзя: правило периода живёт на сервере.
 */
export function periodHistory(
  accruals: Accrual[] | null | undefined,
  periods: CreatorPeriod[] | null | undefined,
  now: Date = new Date(),
): PeriodHistoryRow[] {
  const all = periods ?? [];
  // По возрастанию: рост считается от предыдущей строки, и порядок здесь
  // не оформление, а часть расчёта.
  const asc = [...(accruals ?? [])].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const rows: PeriodHistoryRow[] = [];
  let prevClosed: { views: number } | null = null;
  for (const a of asc) {
    const p = periodOf(all, a.period_start);
    const open = p?.status === 'open';
    const row: PeriodHistoryRow = {
      id: a.id,
      title: p ? periodTitle(p, now) : periodDay(a.period_start, true),
      periodStart: a.period_start,
      open,
      total: a.total,
      salary: a.salary,
      viewsBonus: a.views_bonus,
      deduction: a.deduction,
      views: a.views_total,
      videosDelivered: a.videos_delivered,
      videosPlanned: a.videos_planned,
      viewsDelta: null,
      viewsDeltaPercent: null,
      barPercent: 0,
    };
    // Состояние периода неизвестно (его нет в списке) — считаем, что
    // сравнивать нельзя: молчание честнее догадки.
    const closed = !!p && !open;
    if (closed && prevClosed) {
      row.viewsDelta = row.views - prevClosed.views;
      // Делить на ноль нечем: период без просмотров не даёт процента, и
      // «рост на 100%» с нуля — фраза ни о чём.
      row.viewsDeltaPercent =
        prevClosed.views > 0 ? Math.round((row.viewsDelta / prevClosed.views) * 100) : null;
    }
    if (closed) prevClosed = { views: row.views };
    rows.push(row);
  }
  const top = rows.reduce((max, r) => Math.max(max, r.views), 0);
  for (const r of rows) r.barPercent = top > 0 ? Math.round((r.views / top) * 100) : 0;
  return rows.reverse();
}

/** Куда поехали просмотры между двумя законченными периодами. */
export interface ViewsTrend {
  title: string;
  views: number;
  prevViews: number;
  delta: number;
  /** null — в прошлом периоде был ноль, делить не на что. */
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Рост от периода к периоду — по двум последним ЗАКОНЧЕННЫМ периодам.
 *
 * null, когда законченный период всего один: тренда из одной точки не
 * бывает, а нарисовать его — ровно та выдуманная мотивация, которой
 * здесь быть не должно.
 */
export function viewsTrend(history: PeriodHistoryRow[]): ViewsTrend | null {
  const row = history.find((r) => r.viewsDelta !== null);
  if (!row || row.viewsDelta === null) return null;
  const delta = row.viewsDelta;
  return {
    title: row.title,
    views: row.views,
    prevViews: row.views - delta,
    delta,
    percent: row.viewsDeltaPercent,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

/** Заработанное по законченным периодам. Идущий не считаем: он ещё вырастет. */
export function earnedTotal(history: PeriodHistoryRow[]): { total: number; periods: number } {
  const closed = history.filter((r) => !r.open);
  return {
    // Сложение готовых сумм из начислений — не расчёт тарифа: каждое
    // слагаемое посчитал сервер, и разойтись здесь нечему.
    total: closed.reduce((sum, r) => sum + r.total, 0),
    periods: closed.length,
  };
}

// ---- площадки в профиле ----

/**
 * Площадки, под которые в профиле специалиста есть поле для ссылки.
 *
 * Likee в этот список не входит намеренно: в редакторе профиля такого
 * поля нет вовсе (см. SOCIAL_NETWORKS в shared/lib/social-links.ts), и
 * сказать «заполните Likee» значит отправить человека туда, где нечего
 * нажать. Появится поле — площадка добавится сюда.
 */
export const PROFILE_PLATFORMS: readonly Platform[] = ['tiktok', 'instagram', 'youtube', 'vk'];

/**
 * Площадки проекта, для которых в профиле не указан аккаунт.
 *
 * Это не придирка к заполненности профиля: один ролик идёт на все
 * площадки проекта, и просмотры по ним складываются в бонус — площадка,
 * на которой человека нет, просмотров не приносит.
 */
export function missingAccountLinks(
  projectPlatforms: readonly Platform[],
  links: Partial<Record<Platform, string>> | null | undefined,
): Platform[] {
  const have = links ?? {};
  return projectPlatforms.filter((p) => PROFILE_PLATFORMS.includes(p) && !(have[p] ?? '').trim());
}

// ---- что делать дальше ----

/**
 * Одно ближайшее действие, и только одно.
 *
 * Порядок не вкусовой: сдача ссылок — работа, за которую с человека
 * спросят и за недосдачу снимут с оклада; площадка в профиле — деньги,
 * которые он может взять сам, но медленнее. Список из трёх советов сразу
 * не читается как список задач, он читается как упрёк.
 *
 * Добора до ступени здесь БОЛЬШЕ НЕТ, и это не упущение. Он говорился
 * дважды: карточка «Заработок за период» и так пишет «осталось 100 тыс.
 * просмотров», «≈ +3 564 ₽» и держит кнопку «Добавить ролик», а этот
 * блок повторял ровно те же два числа другими словами и ставил вторую
 * такую же кнопку. Из двух мест правильное — карточка: рядом с числами,
 * ради которых добор и делают. Здесь же он был чужим ещё и по смыслу —
 * блок существует ради случая «сдавать нечего», а не ради денег.
 *
 * Действие при этом не потерялось: next_step_forecast сервер отдаёт
 * только когда у проекта есть период (см. nextStepForecast в billing),
 * то есть ровно тогда, когда карточка заработка нарисована, а кнопку в
 * ней сторожит то же условие «период открыт», что стояло и здесь.
 * В подытоженном периоде блока теперь нет вовсе — и правильно: завести
 * выкладку туда сервер всё равно не даст.
 */
export type NextStepKind = 'submit' | 'profile';

export interface NextStepInput {
  /** Есть выкладка, по которой ждут ссылки. */
  hasPending: boolean;
  /** Сколько площадок проекта без аккаунта в профиле. */
  missingAccounts: number;
}

/** null — делать прямо сейчас нечего, и врать об этом не надо. */
export function nextStepKind(i: NextStepInput): NextStepKind | null {
  if (i.hasPending) return 'submit';
  if (i.missingAccounts > 0) return 'profile';
  return null;
}
