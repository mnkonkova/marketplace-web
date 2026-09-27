import { CommentThread, ProjectComment } from '../model/project.types';

// Разбор веток переписки. Менеджерская ручка без параметров отдаёт всё
// разом — клиентскую ветку, ветки всех креаторов и внутренние заметки, —
// и раскладывать их по вкладкам приходится здесь. Клиент и креатор
// получают по одной ветке, но проходят через те же функции: одна логика
// на три роли вместо трёх похожих.

export const THREAD_LABEL: Record<CommentThread, string> = {
  client: 'С заказчиком',
  creator: 'С креатором',
  internal: 'Только менеджерам',
};

// threadOf — ветка записи. Поле thread новое; у записей, сделанных до
// его появления, его нет, и тогда ветку определяет прежний is_internal.
// Ошибиться здесь значит показать внутреннюю заметку клиенту, поэтому
// неизвестное значение считаем внутренним, а не клиентским.
export function threadOf(c: ProjectComment): CommentThread {
  if (c.thread === 'client' || c.thread === 'creator' || c.thread === 'internal') {
    return c.thread;
  }
  return c.is_internal ? 'internal' : 'client';
}

export interface CreatorThread {
  creatorId: string;
  // Имя из первой записи, где автор — сам креатор. У ветки, где писал
  // только менеджер, имени взять неоткуда: подставляет вызывающий.
  name: string;
  items: ProjectComment[];
}

export interface GroupedThreads {
  client: ProjectComment[];
  internal: ProjectComment[];
  creators: CreatorThread[];
}

// groupThreads — разложить общую выдачу менеджера по веткам. Порядок
// внутри ветки — хронологический, как в ответе; ветки креаторов идут в
// порядке первого сообщения.
export function groupThreads(items: ProjectComment[]): GroupedThreads {
  const out: GroupedThreads = { client: [], internal: [], creators: [] };
  const byCreator = new Map<string, CreatorThread>();

  for (const c of items) {
    const t = threadOf(c);
    if (t === 'internal') {
      out.internal.push(c);
      continue;
    }
    if (t === 'client') {
      out.client.push(c);
      continue;
    }
    // creator без thread_user_id адресовать некому: показать его в чужой
    // ветке хуже, чем не показать вовсе.
    const id = c.thread_user_id;
    if (!id) continue;
    let bucket = byCreator.get(id);
    if (!bucket) {
      bucket = { creatorId: id, name: '', items: [] };
      byCreator.set(id, bucket);
      out.creators.push(bucket);
    }
    bucket.items.push(c);
    if (!bucket.name && c.author_id === id && c.author_name) bucket.name = c.author_name;
  }

  return out;
}

// Превью строкой: для списка веток и заголовка уведомления. У html-записи
// берём body_text — тот же текст без разметки; если бэк его не прислал,
// падать в сырой html нельзя, там теги.
export function commentPreview(c: ProjectComment, limit = 90): string {
  const raw = c.body_format === 'html' ? (c.body_text ?? '') : c.body;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

// Кого упомянули из известных участников. Поле mentions — ответ сервера
// о том, до кого уведомление дошло: постороннего он молча разворачивает,
// и в списке его не будет.
export function mentionedNames(c: ProjectComment, names: ReadonlyMap<string, string>): string[] {
  return (c.mentions ?? []).map((id) => names.get(id) ?? 'участник');
}
