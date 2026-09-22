/**
 * Обложка ролика по его ссылкам.
 *
 * Кадра ролика у нас нет: он лежит на чужой площадке, а мы храним только
 * ссылку, счётчики и дату. Но у YouTube адрес превью выводится из
 * идентификатора видео, без ключей и запросов к API, — и это настоящий
 * кадр того самого ролика. Для остальных площадок такого правила нет:
 * TikTok, VK и Instagram отдают превью только через свои API с токеном,
 * поэтому там по-прежнему знак площадки на её цвете.
 *
 * Возвращаем null, а не пустую строку: «обложки нет» — это состояние, а
 * не пустая картинка. Пустой src в <img> браузер грузит как текущую
 * страницу и показывает битым значком.
 */

/** Идентификатор ролика YouTube из любой из его ссылок. */
export function youtubeId(url: string): string | null {
  const clean = (url || '').trim();
  if (!clean) return null;

  let u: URL;
  try {
    u = new URL(clean);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const ok = (id: string | undefined | null): string | null =>
    id && /^[\w-]{11}$/.test(id) ? id : null;

  if (host === 'youtu.be') return ok(u.pathname.split('/')[1]);
  if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;

  // /watch?v=ID, /shorts/ID, /embed/ID, /live/ID — все формы, которыми
  // площадка отдаёт один и тот же ролик.
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') return ok(u.searchParams.get('v'));
  if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) return ok(parts[1]);
  return null;
}

/**
 * Адрес превью для первой ссылки, из которой его вообще можно вывести.
 *
 * hqdefault отдаётся у любого ролика, в том числе у вертикального: 480×360
 * с полями. maxresdefault бывает не у всех и отвечает 404 — битая картинка
 * вместо обложки хуже, чем её честное отсутствие.
 */
export function videoCoverUrl(links: readonly string[] | undefined): string | null {
  for (const link of links ?? []) {
    const id = youtubeId(link);
    if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  return null;
}
