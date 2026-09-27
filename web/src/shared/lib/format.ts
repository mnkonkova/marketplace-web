export function formatRate(min?: number | null, max?: number | null, currency = 'RUB'): string {
  const sym = currency === 'RUB' ? '₽' : currency;
  if (min != null && max != null && min !== max) {
    return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} ${sym}`;
  }
  if (min != null) return `от ${min.toLocaleString('ru-RU')} ${sym}`;
  if (max != null) return `до ${max.toLocaleString('ru-RU')} ${sym}`;
  return 'по договорённости';
}

/**
 * Максимальная кратность max/min, при которой диапазон ещё что-то сообщает.
 * «100 000 – 100 000 000 ₽» — это не вилка, а «я не понял, что вписать»:
 * клиенту такой диапазон не помогает, а доверие роняет.
 */
const SANE_RATE_SPREAD = 10;

/**
 * Цена для публичной страницы специалиста. В отличие от formatRate:
 *   • нули считаются «не указано» (иначе выходит «от 0 ₽»);
 *   • абсурдно широкая вилка схлопывается до нижней границы.
 * В карточках поиска остаётся formatRate — там строка короче и правится
 * фильтром, менять её поведение из-за одной страницы нельзя.
 */
export function formatPublicRate(
  min?: number | null,
  max?: number | null,
  currency = 'RUB',
): string {
  const sym = currency === 'RUB' ? '₽' : currency;
  const lo = min != null && min > 0 ? min : null;
  const hi = max != null && max > 0 ? max : null;

  if (lo != null && hi != null && hi > lo) {
    if (hi / lo > SANE_RATE_SPREAD) return `от ${lo.toLocaleString('ru-RU')} ${sym}`;
    return `${lo.toLocaleString('ru-RU')}–${hi.toLocaleString('ru-RU')} ${sym}`;
  }
  if (lo != null) return `от ${lo.toLocaleString('ru-RU')} ${sym}`;
  if (hi != null) return `до ${hi.toLocaleString('ru-RU')} ${sym}`;
  return 'по договорённости';
}

export function formatDuration(sec?: number | null): string {
  if (sec == null || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Русская плюрализация: «1 ролик», «2 ролика», «5 роликов».
 *
 * Форму числа никакой pipe за нас не выберет, а «1 выкладок» и «по 1
 * роликам» на экранах проекта читались как недоделка, которой никто не
 * занимался. Правило одно на всё приложение, поэтому и функция одна:
 * три формы на вход, слово на выход — число места вызова уже знают и
 * печатают его сами (часто через `| number`, с разрядами).
 *
 * Отрицательные и дробные тоже бывают (сдвиг срока, «−1 день»), поэтому
 * считаем по модулю и по целой части.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.floor(Math.abs(n));
  const m10 = abs % 10;
  const m100 = abs % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function pluralCategories(n: number): string {
  return plural(n, 'категория', 'категории', 'категорий');
}

export function pluralSpecialists(n: number): string {
  return `${n} ${plural(n, 'специалист', 'специалиста', 'специалистов')}`;
}

/**
 * «3 дня назад» — насколько давно это было.
 *
 * Нужна там, где вопрос звучит как «что не двигалось неделю»: точная дата
 * на него не отвечает, её приходится вычитать из сегодняшней в уме.
 * Саму дату при этом терять нельзя — место вызова показывает её в title.
 *
 * now передаётся снаружи, чтобы результат был проверяемым: иначе тест на
 * «три дня назад» зависит от того, в какую секунду он запустился.
 */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const min = Math.floor((now - ts) / 60_000);
  // Отрицательная разница — часы браузера ушли вперёд относительно
  // сервера. «Через 2 минуты» тут было бы враньём в другую сторону.
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  const m = Math.floor(d / 30);
  return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`;
}
