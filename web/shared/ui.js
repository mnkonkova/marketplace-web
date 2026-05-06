/* ──────────────────────────────────────────────────────────────────
   shared/ui — DOM-утилиты, форматтеры, общие SVG-сниппеты.
   ────────────────────────────────────────────────────────────────── */

import { state } from "./state.js";

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function fmt(n) { return new Intl.NumberFormat("ru-RU").format(n); }

export function pluralSpecialists(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} специалист`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} специалиста`;
  return `${n} специалистов`;
}

export function specialistsWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "специалист";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "специалиста";
  return "специалистов";
}

export function categoryTitle(code) {
  const c = state.categories.find(x => x.code === code);
  return c ? c.title : code;
}

// skillTitle — превращает slug навыка в человекочитаемое имя через каталог
// в state.skills. Если каталог ещё не загружен или slug неизвестен — отдаём
// сам slug (лучше что-то, чем ничего).
export function skillTitle(slug) {
  const all = state.skills || [];
  const s = all.find(x => x.slug === slug);
  return s ? s.title : slug;
}

export function formatRate(min, max, cur) {
  cur = cur || "RUB";
  if (min == null && max == null) return "ставка по договорённости";
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)} ${cur}`;
  if (min != null) return `от ${fmt(min)} ${cur}`;
  return `до ${fmt(max)} ${cur}`;
}

export const ARROW_SVG =
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
     <path d="M5 12h14M13 6l6 6-6 6"/>
   </svg>`;
