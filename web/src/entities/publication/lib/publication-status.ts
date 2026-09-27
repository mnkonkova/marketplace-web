import {
  ALL_PLATFORMS,
  Platform,
  Publication,
  PublicationStatus,
} from '../model/publication.types';
import { plural } from '@shared/lib/format';

// Единственное место истины для подписей выкладки. Бэк отдаёт status и
// вычисленный overdue отдельными полями: «просрочено» — не статус, а
// свойство planned/partial, и склеивать их на каждом экране заново значит
// разъезжаться в формулировках.

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Reels',
  youtube: 'Shorts',
  vk: 'VK Клипы',
  likee: 'Likee',
};

/**
 * Фирменный цвет площадки.
 *
 * Единственное место, где мы отходим от своей палитры, и это оправданно:
 * площадку узнают по цвету раньше, чем прочтут название, — а в полосе
 * состава и в ряду карточек читать пять подписей подряд человек не
 * станет. Свои токены остаются на всём остальном: фон, рамки, текст и
 * акценты берутся из дизайн-системы, а не отсюда.
 *
 * Значения — оттенки самих площадок. Три из пяти красноватые, и это не
 * недосмотр: такие они и есть. Различать их помогают короткие метки на
 * плашках (TT, IG, YT) и зазоры между кусками полосы, а не подкрученный
 * в сторону от бренда тон.
 */
export const PLATFORM_COLOR: Record<Platform, string> = {
  tiktok: '#fe2c55',
  instagram: '#e1306c',
  youtube: '#ff3b30',
  vk: '#4c86f7',
  likee: '#17c3b2',
};

export const PLATFORM_SHORT: Record<Platform, string> = {
  tiktok: 'TT',
  instagram: 'IG',
  youtube: 'YT',
  vk: 'VK',
  likee: 'LK',
};

// Подпись креатора. Имя приходит отдельным полем во всех выдачах, где
// раньше был голый uuid: в выкладках, в отчёте, в ленте и календаре
// клиента, в кандидатах заказа. Обрезанный id больше не показываем — он
// ничего не значит ни менеджеру, ни клиенту.
export function creatorLabel(name?: string): string {
  const n = name?.trim();
  return n ? n : 'Без имени';
}

export interface PublicationBadge {
  label: string;
  // Цвет ng-zorro-тега.
  color: string;
  // Тон для собственной вёрстки: маппится на токены дизайн-системы.
  tone: 'ok' | 'warn' | 'late' | 'neutral';
}

// publicationBadge — бейдж выкладки. Порядок веток важен: отменённая и
// закрытая вручную не бывают «просроченными», а просрочка перебивает
// «назначено» и «частично».
export function publicationBadge(pub: Publication): PublicationBadge {
  if (pub.status === 'cancelled') {
    return { label: 'Отменена', color: 'default', tone: 'neutral' };
  }
  if (pub.status === 'closed_manually') {
    return { label: 'Закрыта менеджером', color: 'purple', tone: 'neutral' };
  }
  if (pub.status === 'done') {
    return { label: 'Выложено', color: 'green', tone: 'ok' };
  }
  if (pub.overdue) {
    return { label: 'Просрочено', color: 'red', tone: 'late' };
  }
  if (pub.pending_date_request) {
    return { label: 'Ждёт переноса', color: 'blue', tone: 'neutral' };
  }
  if (pub.status === 'partial') {
    return { label: 'Выложено частично', color: 'gold', tone: 'warn' };
  }
  return { label: 'Назначено', color: 'default', tone: 'neutral' };
}

// Выкладка ещё ждёт ссылок — только по таким имеет смысл показывать формы
// сдачи и напоминания (Status.IsOpen на бэке).
export function isOpen(status: PublicationStatus): boolean {
  return status === 'planned' || status === 'partial';
}

// Досылать ссылки нельзя: бэк ответит publication_closed. Кнопку в таком
// состоянии не показываем, а не ловим 409 после нажатия.
export function canSubmitLinks(pub: Publication): boolean {
  return isOpen(pub.status);
}

export function submittedPlatforms(pub: Publication): Platform[] {
  return pub.links.map((l) => l.platform);
}

// Каких площадок ещё нет. Порядок — как в AllPlatforms на бэке.
export function missingPlatforms(pub: Publication): Platform[] {
  const have = new Set(submittedPlatforms(pub));
  return ALL_PLATFORMS.filter((p) => !have.has(p));
}

export function linkFor(pub: Publication, platform: Platform) {
  return pub.links.find((l) => l.platform === platform);
}

// Дней до дедлайна: отрицательное — просрочка. Считаем по календарным
// суткам, а не по миллисекундам: «завтра в 00:10» — это один день, а не
// ноль.
export function daysLeft(dueDate: string, now: Date = new Date()): number {
  const due = new Date(dueDate);
  const a = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

// Человеческая подпись срока: «−3 дня», «сегодня», «через 2 дня».
export function dueLabel(dueDate: string, now: Date = new Date()): string {
  const d = daysLeft(dueDate, now);
  if (d === 0) return 'сегодня';
  const n = Math.abs(d);
  // Форма слова — общим хелпером: своя копия правила здесь однажды уже
  // разошлась с остальными счётчиками («11 дня» против «11 дней»).
  const tail = plural(n, 'день', 'дня', 'дней');
  return d < 0 ? `−${n} ${tail}` : `${n} ${tail}`;
}

// Сколько ссылок собрано из пяти — та самая строка «10 из 20 ссылок»
// в шапке проекта.
export function linksCollected(items: Publication[]): { done: number; total: number } {
  const live = items.filter((p) => p.status !== 'cancelled');
  return {
    // links может не приехать вовсе: у выкладки без ссылок сервер долго
    // отдавал null вместо пустого массива, и страница падала целиком —
    // вместе со всем, что рисуется ниже. Сервер починен, защита
    // остаётся: одно поле в null не должно ронять экран.
    done: live.reduce((sum, p) => sum + (p.links?.length ?? 0), 0),
    total: live.length * ALL_PLATFORMS.length,
  };
}

// Выкладка закрыта: сдана целиком или закрыта менеджером руками.
// Отдельным предикатом, а не повтором условия по месту: по этому же
// признаку тач-слой сворачивает уже сделанное.
export function isClosed(pub: Publication): boolean {
  return pub.status === 'done' || pub.status === 'closed_manually';
}

export function closedCount(items: Publication[]): number {
  return items.filter(isClosed).length;
}
