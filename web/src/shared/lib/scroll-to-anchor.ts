const HOME_SECTION_IDS = new Set(['production', 'promotion']);

export function getAppHeaderScrollOffset(): number {
  const header = document.querySelector<HTMLElement>('app-header .header-wrap');
  return (header?.getBoundingClientRect().height ?? 64) + 12;
}

export function isHomeSectionAnchor(id: string): boolean {
  return HOME_SECTION_IDS.has(id);
}

export function scrollToAnchorElement(id: string, offset = getAppHeaderScrollOffset()): boolean {
  const el = document.getElementById(id);
  if (!el) return false;

  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  return true;
}

export function scrollToAnchorWhenReady(id: string, maxWaitMs = 5000): void {
  const started = performance.now();
  const offset = getAppHeaderScrollOffset();

  const tick = (): void => {
    if (scrollToAnchorElement(id, offset)) return;
    if (performance.now() - started >= maxWaitMs) return;
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}
