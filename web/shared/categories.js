/* ──────────────────────────────────────────────────────────────────
   shared/categories — загрузка справочника категорий + статистики.
   Рендер сетки на главной живёт в pages/roadmap.js — caller сам решает,
   нужно ли что-то перерисовывать после загрузки.
   ────────────────────────────────────────────────────────────────── */

import { API, state } from "./state.js";

export async function loadCategories() {
  const [catsRes, statsRes] = await Promise.all([
    fetch(`${API}/categories`),
    fetch(`${API}/categories/stats`).catch(() => null),
  ]);
  if (!catsRes.ok) throw new Error("categories failed");
  const data = await catsRes.json();
  state.categories = data.items || [];

  state.categoryCounts = {};
  if (statsRes && statsRes.ok) {
    const stats = await statsRes.json();
    (stats.items || []).forEach(s => { state.categoryCounts[s.code] = s.count; });
  }
}
