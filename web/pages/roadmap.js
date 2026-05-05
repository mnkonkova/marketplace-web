/* ──────────────────────────────────────────────────────────────────
   pages/roadmap — главная: hero + bento-сетка категорий.
   Категории грузит shared/categories.js, тут только рендер и привязки.
   ────────────────────────────────────────────────────────────────── */

import { state, ICONS, tileTitle, CATEGORY_GROUPS } from "../shared/state.js";
import { $, $$, escape, pluralSpecialists } from "../shared/ui.js";
import { showView, navigate } from "../shared/router.js";
import { openClarify } from "./clarify.js";
import { openCategory } from "./results.js";

export function routeHome() {
  showView("roadmap");
}

/* ───── component: symmetric category tile ────────────────────── */

function categoryCardEl(cat, count, { index = 0 } = {}) {
  const card = document.createElement("div");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.className = "cat-card group";
  card.setAttribute("aria-label", `${cat.title} — смотреть всех специалистов`);

  const icon = ICONS[cat.code] || "·";
  const countText = count > 0 ? pluralSpecialists(count) : "пока никого";
  const num = String(index + 1).padStart(2, "0");

  card.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <span class="cat-index">${num}</span>
        <span class="cat-icon-mark">${icon}</span>
      </div>
      <span class="cat-pill">${count > 0 ? count : "—"}</span>
    </div>

    <div class="min-w-0">
      <div class="cat-title text-[17px] sm:text-[20px] md:text-[22px] font-semibold tracking-tight text-white leading-[1.1] line-clamp-2" lang="ru">
        ${escape(tileTitle(cat))}
      </div>
      <p class="cat-desc-hover text-[12px] text-white/60 leading-snug line-clamp-3">${escape(cat.description || "")}</p>
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3 border-t border-white/[0.05]">
      <span class="cat-primary-cta">[ Смотреть всех → ]</span>
      <span class="ml-auto text-[10px] uppercase tracking-overline text-white/30">${escape(countText)}</span>
    </div>
  `;

  card.addEventListener("click", () => openCategory(cat));
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCategory(cat);
    }
  });

  return card;
}

function pluralCategories(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "категория";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "категории";
  return "категорий";
}

function groupSectionEl(group, cats) {
  const section = document.createElement("section");
  section.className = "flex flex-col gap-6";

  const header = document.createElement("div");
  header.className = "flex items-baseline justify-between gap-3 flex-wrap";
  header.innerHTML = `
    <div class="flex items-baseline gap-3">
      <span class="inline-block w-1.5 h-1.5 bg-mint-500"></span>
      <h3 class="text-lg md:text-xl font-semibold tracking-tight text-white">${escape(group.title)}</h3>
      <span class="text-[11px] uppercase tracking-overline text-white/40">${escape(group.kicker || "")}</span>
    </div>
    <span class="text-[10px] uppercase tracking-overline text-white/30 tabular-nums">${cats.length} ${pluralCategories(cats.length)}</span>
  `;

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-white/[0.06] border border-white/[0.06]";
  cats.forEach((cat, idx) => {
    const count = state.categoryCounts[cat.code] || 0;
    grid.appendChild(categoryCardEl(cat, count, { index: idx }));
  });

  section.appendChild(header);
  section.appendChild(grid);
  return section;
}

export function renderRoadmap() {
  const root = $("#roadmap");
  root.innerHTML = "";

  const byCode = new Map(state.categories.map(c => [c.code, c]));
  const used = new Set();

  CATEGORY_GROUPS.forEach(group => {
    const cats = group.codes.map(code => byCode.get(code)).filter(Boolean);
    if (!cats.length) return;
    cats.forEach(c => used.add(c.code));
    root.appendChild(groupSectionEl(group, cats));
  });

  // Хвост: категории, которых нет ни в одной группе (новые коды в БД).
  const orphans = state.categories.filter(c => !used.has(c.code));
  if (orphans.length) {
    root.appendChild(groupSectionEl(
      { id: "other", title: "Прочее", kicker: "" },
      orphans,
    ));
  }

  const total = Object.values(state.categoryCounts).reduce((a, b) => a + b, 0);
  const totalEl = $("#show-all-count");
  const btn = $("#show-all-specialists");
  if (totalEl && btn) {
    if (total > 0) {
      totalEl.textContent = String(total);
      btn.classList.remove("hidden");
    } else {
      totalEl.textContent = "";
    }
  }
}

function showAllSpecialists() {
  // вся работа — в routeSearch
  navigate("/search");
}

function submitHero() {
  const text = $("#hero-input").value.trim();
  if (!text) return;
  $("#hero-input").value = "";
  openClarify(null, { initialUserText: text });
}

export function bindHero() {
  // Логотип — SPA-навигация: без полного reload, чтобы не сбрасывать
  // in-memory state (cart, results, clarify-history). Cmd/Ctrl/Shift-клик и
  // средняя кнопка пропускаются — там пусть отрабатывает дефолтный <a>.
  const homeLink = $("#home-link");
  if (homeLink) {
    homeLink.addEventListener("click", e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate("/");
    });
  }

  $("#hero-form").addEventListener("submit", e => {
    e.preventDefault();
    submitHero();
  });
  $("#hero-input").addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitHero();
    }
  });

  // suggestion chips → префилл и фокус
  $$("[data-prefill]").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-prefill") || "";
      const input = $("#hero-input");
      input.value = text;
      input.focus();
      // курсор в конец
      try {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      } catch (_) {}
    });
  });

  const showAllBtn = $("#show-all-specialists");
  if (showAllBtn) showAllBtn.addEventListener("click", showAllSpecialists);
}
