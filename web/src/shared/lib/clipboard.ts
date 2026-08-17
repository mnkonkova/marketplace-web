/**
 * Копирование в буфер обмена с фолбэком на legacy execCommand.
 *
 * navigator.clipboard живёт только в secure context (https:// или localhost).
 * На http://192.168.x.x:4200 во время разработки он кидает DOMException,
 * поэтому нужен второй путь. Вынесено в shared, потому что копировать ссылку
 * умеют и кабинет (profile-share), и публичная страница (share-card).
 */
export function copyToClipboard(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Прячем визуально, но оставляем в дереве — иначе iOS Safari не копирует.
    // position:fixed чтобы не скроллило viewport.
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    // execCommand deprecated, но `copy` поддерживается всеми браузерами.
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
