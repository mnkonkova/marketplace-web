import type { Payment, PeriodBase, ProjectPeriod } from '../model/billing.types';

// Подписи периода.
//
// Период не совпадает с календарным месяцем: он начинается датой первой
// публикации и катится от неё. Поэтому в интерфейсе он везде называется
// периодом и показывается ДАТАМИ — «Период 2 · 15 сентября — 14 октября».
// Написать «сентябрь» значит соврать ровно в том месте, где человек и
// должен заметить разницу.

// Родительный падеж: это дата, а не заголовок месяца. Список свой, а не
// общий с MONTH_NAMES из money.ts, именно из-за падежа: «15 сентябрь»
// и «сентября 2026» одинаково нечитаемы, а склонять в рантайме нечего —
// форм всего двенадцать.
const MONTHS_OF = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

// Подписи одинаковы для всех трёх ролей: номер, границы и состояние есть
// у каждой. Переносы у ролей свои, и в подписях их нет — за ними ходят к
// конкретному типу.
export type AnyPeriod = PeriodBase;

// Год, месяц и день из ответа сервера.
//
// Режем строку, а не строим Date: границы периода — календарные дни,
// присланные полуночью UTC, и new Date() в браузере восточнее Гринвича
// сдвигает их на сутки назад. Один и тот же период показывался бы в
// Москве и в Лиссабоне разными датами.
function ymd(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** «14 октября», с годом — когда он не подразумевается. */
export function periodDay(iso: string, withYear = false): string {
  const p = ymd(iso);
  if (!p) return '';
  const name = MONTHS_OF[p.m - 1] ?? '';
  const head = `${p.d} ${name}`.trim();
  return withYear ? `${head} ${p.y}` : head;
}

/**
 * «15 сентября — 14 октября».
 *
 * Год дописываем, только когда он не очевиден: период прошлого года или
 * период через Новый год. В остальных случаях он бы просто удлинял
 * строку, которая стоит в заголовке рядом с номером.
 */
export function periodRange(p: AnyPeriod, now: Date = new Date()): string {
  const from = ymd(p.starts_on);
  const to = ymd(p.ends_on);
  if (!from || !to) return '';
  const year = now.getFullYear();
  const needYear = from.y !== to.y || from.y !== year || to.y !== year;
  return `${periodDay(p.starts_on, needYear)} — ${periodDay(p.ends_on, needYear)}`;
}

/** «Период 2 · 15 сентября — 14 октября» — подпись целиком. */
export function periodTitle(p: AnyPeriod | null | undefined, now: Date = new Date()): string {
  if (!p) return '';
  const range = periodRange(p, now);
  return range ? `Период ${p.seq} · ${range}` : `Период ${p.seq}`;
}

/** Период ещё идёт: числа изменятся. */
export function isOpenPeriod(p: AnyPeriod | null | undefined): boolean {
  return !!p && p.status === 'open';
}

/**
 * «по состоянию на 14 октября» — на какую дату сняты числа.
 *
 * Только у подытоженного периода. Просто «за период» не отвечает на
 * вопрос, когда эти просмотры мерили, а между концом периода и срезом
 * проходит две недели.
 */
export function snapshotNote(p: AnyPeriod | null | undefined): string {
  if (!p || !p.snapshot_as_of) return '';
  return `по состоянию на ${periodDay(p.snapshot_as_of)}`;
}

/**
 * Номер периода из адреса.
 *
 * Пусто, мусор и бессмыслица («0», «-3», «2.5») — это «текущий период»,
 * а не ошибка: адрес правят руками и присылают друг другу в чате, и
 * ронять экран из-за опечатки в номере незачем. Ручка на пустой
 * параметр отвечает текущим периодом — фронт ведёт себя так же.
 */
export function parsePeriodParam(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Периоды для выпадашки, свежий первым.
 *
 * Список приходит с сервера — это и есть смысл ручки /billing/periods.
 * Раньше здесь рисовались последние двенадцать календарных месяцев:
 * список месяцев, про которые никто не знал, есть ли там хоть что-то.
 */
export function periodOptions(items: ProjectPeriod[]): ProjectPeriod[] {
  return [...items].sort((a, b) => b.seq - a.seq);
}

/** Предыдущий период по счёту. Пусто, когда текущий — первый. */
export function previousSeq(p: AnyPeriod | null | undefined): number | null {
  return p && p.seq > 1 ? p.seq - 1 : null;
}

/**
 * Период, которому принадлежит начисление.
 *
 * Строка заработка знает только дату начала своего периода, а «с какого
 * по какое» лежит в периодах. Сопоставляем по этой дате; не нашлось —
 * возвращаем null, и подпись показывает дату как есть. Достраивать
 * границы самим нельзя: это была бы вторая копия правила периода.
 */
export function periodOf<T extends AnyPeriod>(periods: T[], periodStart: string): T | null {
  const key = (periodStart ?? '').slice(0, 10);
  if (!key) return null;
  return periods.find((p) => p.starts_on.slice(0, 10) === key) ?? null;
}

/**
 * По периоду рассчитались: менеджер отметил, что деньги пришли.
 *
 * Зачем правило вообще. Счёт за подытоженный период — единственное на
 * экране заказчика, что требует действия, и снимать его обязано
 * поступление денег, а не смена календаря. Раньше плашка «К оплате за
 * прошлый период» жила ровно один период: начинался следующий — и
 * прошлый становился позапрошлым, а напоминание исчезало само,
 * независимо от того, заплатили по нему или нет.
 *
 * Почему именно финальный платёж. Платёжного провайдера у нас нет:
 * деньги идут мимо системы, и единственная отметка о получении — та,
 * что менеджер ставит кнопкой «Деньги пришли» (Payment.status =
 * confirmed). Предоплата сюда не годится — она про старт работ, а не
 * про закрытие периода.
 *
 * Почему сравниваем даты. Платёж в базе один на проект и вид
 * (уникальный ключ project_id + kind), а периодов у проекта много.
 * Отметка, поставленная за первый период, висела бы подтверждённой
 * вечно и гасила бы счета за все следующие — то есть врала бы ровно
 * там, где речь о деньгах. Поэтому расчётом по ЭТОМУ периоду считается
 * только подтверждение, сделанное не раньше его конца: раньше конца
 * платить было не за что.
 *
 * Дату режем строкой, а не через Date: границы периода приходят
 * календарными днями, и new Date() восточнее Гринвича сдвинет их на
 * сутки — тот же разбор, что и в ymd() выше.
 */
export function periodSettled(
  p: AnyPeriod | null | undefined,
  payments: readonly Payment[] | null | undefined,
): boolean {
  if (!p) return false;
  const endsOn = (p.ends_on ?? '').slice(0, 10);
  if (!endsOn) return false;
  return (payments ?? []).some((pay) => {
    if (pay.kind !== 'final' || pay.status !== 'confirmed') return false;
    const at = (pay.confirmed_at ?? '').slice(0, 10);
    return !!at && at >= endsOn;
  });
}
