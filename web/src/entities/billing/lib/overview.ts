import { ALL_PLATFORMS, Platform } from '@entities/publication/model/publication.types';

import type { OverviewPlatform, OverviewPoint, OverviewRange } from '../model/billing.types';

/**
 * Разбор дашборда заказчика: окно, доли площадок и приросты.
 *
 * Вынесено из виджета, потому что это единственные места, где экран
 * что-то РЕШАЕТ, а не показывает: какое окно считать выбранным, из чего
 * складывается полоса состава и чем отличается «прироста нет» от
 * «прирост нулевой». Внутри компонента всё это проверялось бы только
 * через отрисованную разметку, то есть не проверялось бы вовсе.
 */

export const RANGE_LABEL: Record<OverviewRange, string> = {
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
};

/** Порядок вкладок переключателя. От короткого окна к длинному. */
export const RANGE_TABS: readonly OverviewRange[] = ['week', 'month', 'quarter'] as const;

/**
 * Окно словом: «за месяц».
 *
 * Стоит рядом с каждым оконным числом. Без него оконное число оказывается
 * на одном экране с итогом за всё время неотличимым от него, человек
 * складывает их — и получает величину, которой нет нигде.
 */
export const RANGE_OF: Record<OverviewRange, string> = {
  week: 'за неделю',
  month: 'за месяц',
  quarter: 'за квартал',
};

/** С чем сравнивается прирост: «к прошлому месяцу». */
export const RANGE_PREV: Record<OverviewRange, string> = {
  week: 'к прошлой неделе',
  month: 'к прошлому месяцу',
  quarter: 'к прошлому кварталу',
};

/**
 * Окно из адреса.
 *
 * Окно живёт в адресе, а не в памяти вкладки: этот экран показывают
 * начальству, и ссылка на «квартал» обязана открыться кварталом, а не
 * тем, что смотрел последним владелец ссылки.
 *
 * Мусор и пустота — месяц, а не ошибка: с правленым руками адресом
 * человек пришёл смотреть цифры, а не читать про неверный параметр.
 * Месяц по умолчанию потому, что период проекта считается месяцами.
 */
export function parseRange(raw: string | null | undefined): OverviewRange {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'week' || v === 'month' || v === 'quarter' ? v : 'month';
}

/**
 * Подпись под именем заказчика: «Все площадки · 17 авг. — 15 сент. 2026».
 *
 * Границы окна считает сервер и присылает готовой строкой: у недели и
 * квартала они зависят от того, с какого дня собирают данные, и
 * посчитанные на фронте разошлись бы с числами, которые рядом.
 *
 * Пока подписи нет — называем окно словом. Пустое место после «Все
 * площадки ·» выглядит недогрузом, а не отсутствием подписи.
 */
export function windowCaption(range: OverviewRange, rangeLabel?: string): string {
  const tail = rangeLabel?.trim() || RANGE_OF[range];
  return `Все площадки · ${tail}`;
}

/** Строка площадки в дашборде: и для полосы состава, и для карточки. */
export interface PlatformShare {
  platform: Platform;
  /** Просмотры ЗА ОКНО: рядом с ними в дашборде всегда стоит период. */
  views: number;
  /** Доля в подписи легенды, целые проценты. Тоже за окно. */
  percent: number;
  /** Доля в полосе состава, точная: из неё складывается ширина куска. */
  width: number;
  erPercent?: number;
  erWithoutShares: boolean;
  deltaPct?: number;
  series: OverviewPoint[];
}

/** Просмотры площадки за окно. Старый ответ окна не знает — там итог. */
function windowViews(row: OverviewPlatform): number {
  return Math.max(0, row.window_views ?? row.views ?? 0);
}

/**
 * Площадки для дашборда — все пять всегда, по убыванию вклада.
 *
 * Числа здесь ОКОННЫЕ. Иначе доли не сойдутся с главным числом героя,
 * которое тоже оконное, и человек, сложив их, получит третью величину,
 * которой нигде нет.
 *
 * Пропавшая карточка читается как сбой, а не как ноль: человек ищет,
 * куда делся Likee, вместо того чтобы прочитать «на Likee пока ничего».
 * Поэтому недостающие площадки достаются нулями, а лишние (площадка,
 * которой у нас нет) выбрасываются — рисовать чужой бренд в отчёте
 * заказчика мы не можем.
 *
 * Ширина куска полосы считается ЗДЕСЬ, из просмотров, а не берётся из
 * доли: округлённые до целых доли пяти площадок дают в сумме то 99, то
 * 101 процент, и полоса состава либо не сходится справа, либо
 * переполняется. В легенде при этом стоит доля сервера — это то же
 * число, которым он оперирует в своих отчётах.
 *
 * @param byPlatform просмотры за всё время из старого ответа. Только на
 * время раскатки бэкенда: пока `platforms` не приехал, состав рисуется
 * по ним, и тогда он про всё время — но и окна на таком ответе нет.
 */
export function platformShares(
  platforms: readonly OverviewPlatform[] | undefined,
  byPlatform?: Record<string, number>,
): PlatformShare[] {
  const rows = new Map<string, OverviewPlatform>();
  for (const p of platforms ?? []) rows.set(p.platform, p);

  const viewsOf = (p: Platform): number => {
    const row = rows.get(p);
    return row ? windowViews(row) : Math.max(0, byPlatform?.[p] ?? 0);
  };

  const total = ALL_PLATFORMS.reduce((s, p) => s + viewsOf(p), 0);

  return ALL_PLATFORMS.map((platform: Platform) => {
    const row = rows.get(platform);
    const views = viewsOf(platform);
    const share = row?.window_share_pct ?? row?.share_pct;
    return {
      platform,
      views,
      percent: share ?? (total ? Math.round((views / total) * 100) : 0),
      width: total ? (views / total) * 100 : 0,
      erPercent: row?.er_percent,
      erWithoutShares: !!row?.er_without_shares,
      deltaPct: row?.delta_pct,
      series: row?.series ?? [],
    };
  }).sort((a, b) => b.views - a.views);
}

/**
 * Прирост к прошлому окну — в том виде, в каком его можно показать.
 *
 * Три исхода, и путать их нельзя:
 *
 *  • сравнивать не с чем (поля нет) — `known: false` и прочерк. Не ноль
 *    и не зелёная стрелка: мы не знаем, а не «не изменилось».
 *  • сравнили, не изменилось — ноль без стрелки. Стрелка означает
 *    направление, а направления здесь нет.
 *  • упало — минусом и вниз. Отчёт, который умеет показывать только
 *    хорошее, перестают читать вовсе, и вместе с ним перестают верить
 *    хорошим числам.
 */
export interface Delta {
  known: boolean;
  tone: 'up' | 'down' | 'flat';
  /** Пусто, когда направления нет: у прочерка и у нуля стрелки не бывает. */
  arrow: '' | '↑' | '↓';
  text: string;
}

const NO_DELTA: Delta = { known: false, tone: 'flat', arrow: '', text: '—' };

/**
 * @param value прирост: проценты или пункты. undefined — сравнивать не с чем.
 * @param unit 'pct' — проценты, 'pp' — пункты (у ER прирост только в них).
 */
export function formatDelta(value: number | null | undefined, unit: 'pct' | 'pp' = 'pct'): Delta {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DELTA;

  // Минус типографский (U+2212), а не дефис: в моноширинном столбце
  // дефис вдвое короче плюса, и минус теряется на беглом взгляде.
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const body =
    unit === 'pp'
      ? // Неразрывные пробелы: «0,3 п. п.» не должно переноситься по частям.
        `${abs.toFixed(1).replace('.', ',')}\u00a0п.\u00a0п.`
      : `${Math.round(abs)}%`;

  return {
    known: true,
    tone: value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
    arrow: value > 0 ? '↑' : value < 0 ? '↓' : '',
    text: `${sign}${body}`,
  };
}

/**
 * Инициалы для кружка аватара: «Олег Исаев» → «ОИ».
 *
 * Пусто на входе бывает у заказчика, который не заполнил имя. Кружок с
 * одной точкой лучше пустого: без него шапка выглядит недогрузившейся.
 */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return '·';
  return parts.map((p) => p[0].toUpperCase()).join('');
}
