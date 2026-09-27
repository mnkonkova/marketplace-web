// Разметка комментариев. Чистит её сервер: на записи остаются strong, em,
// u, s, p, ul/ol/li, a и упоминания как <span data-mention-user-id="…">,
// всё прочее выбрасывается молча. Здесь два разных дела:
//
// 1) показать пришедшее. Ангуляровский санитайзер вырезает data-атрибуты,
//    поэтому упоминание доехало бы до экрана голым span'ом без подсветки.
//    Перекладываем его в class и отдаём через bypassSecurityTrustHtml —
//    но только после собственного прохода по тому же белому списку, а не
//    на честном слове бэка.
// 2) собрать отправляемое из contenteditable. Редактор на execCommand
//    родит и <b>, и <div>, и style — приводим к тем же тегам, чтобы не
//    гонять на сервер мусор, который он всё равно выкинет.

const ALLOWED = new Set(['STRONG', 'EM', 'U', 'S', 'P', 'UL', 'OL', 'LI', 'A', 'BR', 'SPAN']);

// execCommand и вставка из буфера дают старые синонимы — сводим к тем
// тегам, что понимает сервер.
const ALIAS: Record<string, string> = {
  B: 'STRONG',
  I: 'EM',
  STRIKE: 'S',
  DEL: 'S',
  DIV: 'P',
};

export const MENTION_ATTR = 'data-mention-user-id';

function isHttpUrl(href: string): boolean {
  try {
    const u = new URL(href, 'https://example.invalid');
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Один узел белого списка. keepMention=true — оставить упоминание
// машинно-читаемым (для отправки), false — перевести в class (для показа).
function clean(node: Node, out: Node[], doc: Document, keepMention: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(doc.createTextNode(node.nodeValue ?? ''));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = ALIAS[el.tagName] ?? el.tagName;
  const mention = el.tagName === 'SPAN' ? el.getAttribute(MENTION_ATTR) : null;

  // Не наш тег — теряем обёртку, но сохраняем текст: иначе вставленный
  // из письма кусок исчезнет целиком, а человек этого не заметит.
  if (!ALLOWED.has(tag) || (el.tagName === 'SPAN' && !mention)) {
    for (const child of Array.from(el.childNodes)) clean(child, out, doc, keepMention);
    return;
  }

  const copy = doc.createElement(tag.toLowerCase());
  if (mention) {
    if (keepMention) copy.setAttribute(MENTION_ATTR, mention);
    else copy.className = 'mention';
  }
  if (tag === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (!isHttpUrl(href)) {
      // Ссылка на javascript: — не ссылка. Оставляем текст.
      for (const child of Array.from(el.childNodes)) clean(child, out, doc, keepMention);
      return;
    }
    copy.setAttribute('href', href);
    copy.setAttribute('target', '_blank');
    copy.setAttribute('rel', 'noopener noreferrer');
  }
  const kids: Node[] = [];
  for (const child of Array.from(el.childNodes)) clean(child, kids, doc, keepMention);
  for (const k of kids) copy.appendChild(k);
  out.push(copy);
}

function pass(html: string, keepMention: boolean): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out: Node[] = [];
  for (const child of Array.from(doc.body.childNodes)) clean(child, out, doc, keepMention);
  const holder = doc.createElement('div');
  for (const n of out) holder.appendChild(n);
  return holder.innerHTML;
}

// Готовая к показу разметка: упоминания подсвечены классом, ссылки уводят
// в новую вкладку.
export function renderCommentHtml(html: string): string {
  return pass(html, false);
}

// Готовое к отправке тело из contenteditable.
export function editorBodyHtml(html: string): string {
  return pass(html, true);
}

// Текст без разметки. Нужен там, где html не к месту, и для проверки
// «в поле хоть что-то есть»: <p><br></p> у пустого редактора не пусто.
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').trim();
}

export function isEmptyBody(html: string): boolean {
  return htmlToText(html).length === 0;
}

// Разметка упоминания для вставки в редактор. Упомянуть можно только
// участника ветки: постороннего сервер молча развернёт — текст останется,
// уведомления не будет.
export function mentionHtml(userId: string, displayName: string): string {
  const doc = new DOMParser().parseFromString('<body></body>', 'text/html');
  const span = doc.createElement('span');
  span.setAttribute(MENTION_ATTR, userId);
  span.className = 'mention';
  span.textContent = `@${displayName}`;
  const holder = doc.createElement('div');
  holder.appendChild(span);
  return `${holder.innerHTML}&nbsp;`;
}
