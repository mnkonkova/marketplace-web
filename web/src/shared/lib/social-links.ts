// Нормализация значений соцсетей в кликабельные ссылки. Юзер может
// вводить как "@handle", так и полный URL — фронт обоих случаев приводит
// к https-URL'у. Для whatsapp принимаем телефон в международном формате.
//
// Если значение пустое — возвращаем null (фронт не рендерит иконку).

export type SocialKey =
  | 'telegram'
  | 'whatsapp'
  | 'vk'
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'behance'
  | 'dribbble'
  | 'website';

export interface SocialNetwork {
  key: SocialKey;
  label: string;
  /** Эмодзи для иконки (без зависимости от icon font'а). */
  icon: string;
  /** Placeholder для input в кабинете. */
  placeholder: string;
  /** Hint что писать (отображается под полем). */
  hint: string;
  /** Помечена * запрещ. в РФ. */
  ru_warn?: boolean;
}

export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  {
    key: 'telegram',
    label: 'Telegram*',
    icon: '✈️',
    placeholder: '@username',
    hint: '* работа сервиса в РФ ограничена',
    ru_warn: true,
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    placeholder: '+7 999 1234567',
    hint: 'Телефон в международном формате',
  },
  {
    key: 'vk',
    label: 'ВКонтакте',
    icon: '🌐',
    placeholder: 'vk.com/username',
    hint: 'Ссылка на профиль',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    icon: '▶️',
    placeholder: 'youtube.com/@channel',
    hint: 'Ссылка на канал',
  },
  {
    key: 'instagram',
    label: 'Instagram*',
    icon: '📷',
    placeholder: '@username',
    hint: '* запрещ. организация в РФ',
    ru_warn: true,
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    icon: '🎵',
    placeholder: '@username',
    hint: 'TikTok handle',
  },
  {
    key: 'behance',
    label: 'Behance',
    icon: '🎨',
    placeholder: 'behance.net/username',
    hint: 'Портфолио на Behance',
  },
  {
    key: 'dribbble',
    label: 'Dribbble',
    icon: '🏀',
    placeholder: 'dribbble.com/username',
    hint: 'Портфолио на Dribbble',
  },
  {
    key: 'website',
    label: 'Сайт',
    icon: '🔗',
    placeholder: 'https://...',
    hint: 'Личный сайт',
  },
];

/** Приводит произвольный ввод юзера к кликабельному https-URL'у. */
/**
 * Срезает начало ссылки, скопированной из адресной строки без схемы:
 * «t.me/user», «www.instagram.com/user/» → «user». Без этого такое значение
 * приклеивалось к нашему префиксу и выходило https://t.me/t.me/user.
 */
function stripHost(value: string, ...hosts: string[]): string {
  let v = value.replace(/^\/+/, '');
  for (const host of hosts) {
    const re = new RegExp(`^(?:www\\.)?${host.replace(/\./g, '\\.')}/+`, 'i');
    if (re.test(v)) {
      v = v.replace(re, '');
      break;
    }
  }
  return v.replace(/\/+$/, '');
}

export function socialLinkURL(key: SocialKey, raw: string): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;

  // Если уже валидный http(s) — оставляем как есть.
  if (/^https?:\/\//i.test(v)) return v;

  switch (key) {
    case 'telegram': {
      // @handle, handle, t.me/handle, telegram.me/handle → https://t.me/handle
      const h = stripHost(v, 't.me', 'telegram.me').replace(/^@/, '');
      return h ? `https://t.me/${h}` : null;
    }
    case 'whatsapp': {
      // Телефон → https://wa.me/<digits>. Только цифры (убираем + - пробелы).
      const digits = v.replace(/\D+/g, '');
      if (!digits) return null;
      return `https://wa.me/${digits}`;
    }
    case 'vk': {
      const h = stripHost(v, 'vk.com', 'm.vk.com').replace(/^@/, '');
      return h ? `https://vk.com/${h}` : null;
    }
    case 'youtube': {
      // @channel / channel / youtube.com/@... → https://youtube.com/@channel
      let h = stripHost(v, 'youtube.com', 'm.youtube.com', 'youtu.be');
      if (!h.startsWith('@') && !h.startsWith('channel/') && !h.startsWith('c/')) {
        h = '@' + h;
      }
      return `https://youtube.com/${h}`;
    }
    case 'instagram': {
      const h = stripHost(v, 'instagram.com').replace(/^@/, '');
      return h ? `https://instagram.com/${h}` : null;
    }
    case 'tiktok': {
      const h = stripHost(v, 'tiktok.com').replace(/^@/, '');
      return h ? `https://tiktok.com/@${h}` : null;
    }
    case 'behance': {
      const h = stripHost(v, 'behance.net');
      return h ? `https://behance.net/${h}` : null;
    }
    case 'dribbble': {
      const h = stripHost(v, 'dribbble.com');
      return h ? `https://dribbble.com/${h}` : null;
    }
    case 'website': {
      // Без схемы — добавляем https://
      return `https://${v}`;
    }
  }
}

/** Возвращает только заполненные соцсети с разрешёнными ссылками. */
export function nonEmptySocialLinks(
  links: Partial<Record<SocialKey, string>> | undefined,
): Array<{ network: SocialNetwork; url: string; raw: string }> {
  if (!links) return [];
  const out: Array<{ network: SocialNetwork; url: string; raw: string }> = [];
  for (const net of SOCIAL_NETWORKS) {
    const raw = links[net.key];
    if (!raw) continue;
    const url = socialLinkURL(net.key, raw);
    if (!url) continue;
    out.push({ network: net, url, raw });
  }
  return out;
}
