/* ──────────────────────────────────────────────────────────────────
   pages/results — выдача поиска: подбор, инфинит-скролл по категории,
   фасеты, similar/relaxed-блок. Обрабатывает /search.
   ────────────────────────────────────────────────────────────────── */

import { API, state } from "../shared/state.js";
import { $, escape, categoryTitle, skillTitle, formatRate } from "../shared/ui.js";
import { showView, syncURL, buildSearchQs, gotoSpecialist } from "../shared/router.js";
import { inCart, toggleCart } from "../shared/cart.js";
import { loadCategories, loadSkills } from "../shared/categories.js";
import { preferFeedView, setPreferredView, showFeed, hideFeed } from "./feed.js";

/* ───── routing ──────────────────────────────────────────────────
   /search — единый URL для browse-сценария и для AI-выдачи.
   - Если в qs есть q (clarify-флоу) → AI-summarize → список (компактные карточки).
     Для AI-picks лента не идеальна: подбор уже маленький и кураторский.
   - Иначе (browse: категория или все) → лента или список по preferFeedView().
   ────────────────────────────────────────────────────────────── */

export async function routeSearch(_params, qs) {
  if (!state.categories.length) {
    try { await loadCategories(); } catch (_) {}
  }
  // skills нужны для рендера чипов в spec-row/spec-card. Грузим параллельно
  // с поиском (await не блокируем); если не успеет — отрисуются slug'и.
  loadSkills().catch(() => {});

  const cats = qs.getAll("category");
  const skills = qs.getAll("skill");
  const q = (qs.get("q") || "").trim();
  const city = (qs.get("city") || "").trim();

  // прямой заход — обнуляем in-memory clarify-флоу, чтобы back-кнопки
  // не указывали в пустой чат; cart остаётся (он в storage).
  state.chatHistory = [];
  state.lastPicks = [];
  state.lastPicksMeta = null;
  state.pendingSearch = null;

  if (cats.length === 1) {
    state.currentCategory = state.categories.find(c => c.code === cats[0]) || null;
  } else {
    state.currentCategory = null;
  }

  if (q) {
    // AI-flow — всегда список. Лента включается явно из browse-сценария.
    hideFeed();
    state.pendingSearch = { q, categories: cats, skills, city };
    await runSearch({ pushURL: false });
    setResultsBack("roadmap", "на главную");
    return;
  }

  const params = { categories: cats, skills, city };
  state.lastBrowseParams = params;
  if (preferFeedView()) {
    await showFeed(params, { autoFallback: true });
  } else {
    await routeSearchAsList(params);
  }
}

// routeSearchAsList — старый browse-флоу как список. Зовётся из feed.js при
// переключении «В список», а также из routeSearch если pref=list.
export async function routeSearchAsList(params) {
  hideFeed();
  if (!state.categories.length) {
    try { await loadCategories(); } catch (_) {}
  }
  const cats = (params && params.categories) || [];
  state.currentCategory = (cats.length === 1)
    ? state.categories.find(c => c.code === cats[0]) || null
    : null;

  // Запоминаем browse-параметры — кнопка «В ленту» использует их при свитче.
  state.lastBrowseParams = params || null;
  setResultsViewToggleVisible(true);

  if (cats.length === 1 && state.currentCategory) {
    await showAllInCategory(state.currentCategory, { pushURL: false });
  } else {
    // Дескриптор для возврата из ленты на «всех специалистов» (или
    // multi-cat browse). Ставим до renderAllInCategory, чтобы возможный
    // toggle во время загрузки уже знал куда возвращаться.
    state.lastListView = { kind: "browse", params };
    showView("results");
    setResultsBack("roadmap", "на главную");
    $("#results-title").textContent = "Все специалисты";
    setSummary("Загружаем каталог…", "");
    $("#results").innerHTML = "";
    $("#results-facets").innerHTML = "";
    await renderAllInCategory({ categories: cats }, "");
  }
  setResultsBack("roadmap", "на главную");
}

function setResultsViewToggleVisible(visible) {
  const btn = $("#results-view-toggle");
  if (!btn) return;
  btn.classList.toggle("hidden", !visible);
}

// openCategory — публичная точка входа из roadmap-тайла. Двухуровневое
// решение: (1) если юзер явно выбрал «список» — открываем список; (2) иначе
// открываем ленту с autoFallback=true: лента сама уйдёт в список, если
// видео в этой категории нет.
export async function openCategory(category) {
  const params = { categories: [category.code], skills: [], city: "", q: "" };
  state.lastBrowseParams = params;
  syncURL("/search" + buildSearchQs(params));
  if (!preferFeedView()) {
    await showAllInCategory(category, { pushURL: false });
    return;
  }
  await showFeed(params, { autoFallback: true });
}

// bindResultsViewToggle — однократно навешивает обработчик на кнопку «В ленту».
// Зовётся из app.js при инициализации.
export function bindResultsViewToggle() {
  const btn = $("#results-view-toggle");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    setPreferredView("feed");
    const params = state.lastBrowseParams || {
      categories: state.currentCategory ? [state.currentCategory.code] : [],
      skills: [], city: "", q: "",
    };
    // Снэпшот текущего list-view (AI-подбор / showAllInCategory /
    // showAllForFreeform / browse) — выход из ленты вернёт ровно в него.
    const returnTo = state.lastListView ? { ...state.lastListView } : null;
    await showFeed(params, returnTo ? { returnTo } : {});
  });
}

// renderListView — единая точка входа на «вернуться в последний список».
// Зовётся из feed.js при выходе из ленты, чтобы не дублировать диспатч.
export async function renderListView(descriptor) {
  if (!descriptor) return false;
  switch (descriptor.kind) {
    case "ai-picks":
      restoreAiPicks();
      return true;
    case "all-in-cat":
      if (descriptor.category) {
        await showAllInCategory(descriptor.category, { ...(descriptor.opts || {}), pushURL: false });
        return true;
      }
      return false;
    case "all-by-q":
      if (descriptor.params) {
        await showAllForFreeform(descriptor.params);
        return true;
      }
      return false;
    case "browse":
      await routeSearchAsList(descriptor.params || {});
      return true;
  }
  return false;
}

export async function runSearch({ pushURL = true } = {}) {
  const params = state.pendingSearch || {
    q: "", categories: state.currentCategory ? [state.currentCategory.code] : [],
    skills: [], city: "",
  };

  // Гасим browse-пагинацию ДО любых await: иначе живой IntersectionObserver
  // успеет дёрнуть loadNextAllPage между плейсхолдером и AI-ответом и
  // дорисует browse-строки в #results.
  state.allList = null;

  if (pushURL) syncURL("/search" + buildSearchQs(params));
  showView("results");
  setResultsBack("clarify", "уточнить запрос");
  // AI-выдача дефолтно списком (короткий кураторский подбор), но юзер может
  // нажать «В ленту» — feed-toggle берёт state.lastBrowseParams (см. ниже).
  state.lastBrowseParams = params;
  state.lastListView = { kind: "ai-picks" };
  setResultsViewToggleVisible(true);
  $("#results-title").textContent = state.currentCategory
    ? state.currentCategory.title
    : "Подбор по запросу";
  setSummary("Подбираем для вас…", "");
  $("#results").innerHTML = `<div class="text-center text-white/45 text-[11px] uppercase tracking-overline py-16">AI подбор…</div>`;
  $("#results-facets").innerHTML = "";

  try {
    const sumRes = await fetch(`${API}/search/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        q: params.q || "",
        categories: params.categories || [],
        skills: params.skills || [],
        city: params.city || "",
        limit: 20,
        target_category: state.currentCategory ? state.currentCategory.code : "",
      }),
    });

    if (sumRes.ok) {
      const data = await sumRes.json();
      state.lastSummary = data.summary || "";
      state.lastPicks = data.picks || [];
      if (state.lastPicks.length > 0) {
        state.allList = null;
        state.lastPicksMeta = {
          category: state.currentCategory,
          totalInCategory: data.total_in_category,
          broadened: !!data.broadened,
          searchParams: params,
        };
        const note = data.broadened
          ? "По исходному запросу ничего не нашлось точно, мы подобрали из всей категории."
          : "";
        setSummary(state.lastSummary, note);
        renderShowAllCTA(data.total_in_category, data.picks.length);
        renderResults(state.lastPicks.map(p => ({ ...p.profile, _reason: p.reason })));
        return;
      }
    }

    await renderAllInCategory(params, fallbackBanner("Ничего точного не нашли"));
  } catch (e) {
    await renderAllInCategory(params, fallbackBanner(`Поиск временно недоступен (${e.message})`));
  }
}

function fallbackBanner(prefix) {
  return state.currentCategory
    ? `${prefix} — показываем всех в категории «${state.currentCategory.title}».`
    : `${prefix} — показываем всех специалистов каталога.`;
}

export async function showAllInCategory(category, opts = {}) {
  const { backTo = "roadmap", keepClarify = false, pushURL = true } = opts;
  state.currentCategory = category;
  if (!keepClarify) {
    state.chatHistory = [];
    state.pendingSearch = null;
    state.lastPicks = [];
    state.lastPicksMeta = null;
  }
  if (pushURL) syncURL("/search" + buildSearchQs({ categories: [category.code] }));
  showView("results");
  const labels = { roadmap: "на главную", clarify: "уточнить запрос", picks: "к нашему подбору" };
  setResultsBack(backTo, labels[backTo] || "назад");
  // browse-режим: позволяем переключиться в ленту.
  state.lastBrowseParams = { categories: [category.code], skills: [], city: "", q: "" };
  // Дескриптор для feed→back. «Посмотреть всех в категории» (CTA из AI-подбора,
  // backTo="picks") — это короткий детур из AI-списка, поэтому из ленты
  // возвращаем сразу в AI-подбор, минуя showAllInCategory. В browse-режиме
  // (backTo="roadmap" и т.п.) возврат — в этот же showAllInCategory.
  state.lastListView = backTo === "picks"
    ? { kind: "ai-picks" }
    : { kind: "all-in-cat", category, opts: { backTo, keepClarify } };
  setResultsViewToggleVisible(true);
  $("#results-title").textContent = category.title;
  setSummary("Загружаем всех специалистов в категории…", "");
  $("#results").innerHTML = "";
  $("#results-facets").innerHTML = "";
  await renderAllInCategory({ categories: [category.code] }, "");
}

export function restoreAiPicks() {
  const meta = state.lastPicksMeta;
  if (!state.lastPicks || !state.lastPicks.length || !meta) {
    showView("clarify");
    return;
  }
  state.allList = null;
  state.currentCategory = meta.category || state.currentCategory;
  if (meta.searchParams) syncURL("/search" + buildSearchQs(meta.searchParams));
  showView("results");
  setResultsBack("clarify", "уточнить запрос");
  // Возврат на AI-подбор — тогл «В ленту» доступен, как и при первом показе.
  state.lastBrowseParams = meta.searchParams || state.lastBrowseParams;
  state.lastListView = { kind: "ai-picks" };
  setResultsViewToggleVisible(true);
  $("#results-title").textContent = state.currentCategory ? state.currentCategory.title : "Подбор по запросу";
  $("#results-facets").innerHTML = "";
  const note = meta.broadened
    ? "По исходному запросу ничего не нашлось, мы подобрали из всей категории."
    : "";
  setSummary(state.lastSummary, note);
  renderShowAllCTA(meta.totalInCategory, state.lastPicks.length);
  renderResults(state.lastPicks.map(p => ({ ...p.profile, _reason: p.reason })));
}

function setResultsBack(target, label) {
  const btn = document.querySelector("#view-results .back");
  if (!btn) return;
  btn.dataset.action = `back-${target}`;
  btn.innerHTML =
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>${escape(label)}`;
}

const ALL_LIST_PAGE_SIZE = 30;

async function renderAllInCategory(params, banner) {
  state.allList = null;
  const qs = new URLSearchParams();
  (params.categories || []).forEach(c => qs.append("category", c));
  qs.set("limit", String(ALL_LIST_PAGE_SIZE));
  qs.set("offset", "0");
  try {
    const res = await fetch(`${API}/specialists?${qs.toString()}`);
    if (!res.ok) throw new Error("search_failed");
    const data = await res.json();
    renderFacets(data.facets, params.categories || []);
    const items = data.items || [];
    if (items.length === 0) {
      setSummary("В каталоге пока нет специалистов в этой категории.", "");
      renderResults([]);
      return;
    }
    const total = data.total || items.length;
    state.allList = {
      params,
      pageSize: ALL_LIST_PAGE_SIZE,
      offset: items.length,
      total,
      loading: false,
      done: items.length >= total,
      similar: data.similar || [],
      relaxed: data.relaxed || [],
      similarRendered: false,
    };
    const scope = (params.categories && params.categories.length > 0) ? "В категории" : "В каталоге";
    setSummary(`${scope} найдено ${total}. Добавляйте подходящих в проект — отправите бриф всем разом.`, banner);
    const root = $("#results");
    root.innerHTML = "";
    // browse-список — компактные строки. AI-выдача остаётся на богатых карточках.
    items.forEach(it => root.appendChild(specRow(it)));
    if (state.allList.done) renderSimilarSection();
    else ensureAllListObserver();
  } catch (e) {
    setSummary(`Поиск недоступен: ${e.message}`, "");
    renderResults([]);
  }
}

async function loadNextAllPage() {
  const a = state.allList;
  if (!a || a.loading || a.done) return;
  a.loading = true;
  $("#results-loading").classList.remove("hidden");
  try {
    const qs = new URLSearchParams();
    (a.params.categories || []).forEach(c => qs.append("category", c));
    qs.set("limit", String(a.pageSize));
    qs.set("offset", String(a.offset));
    const res = await fetch(`${API}/specialists?${qs.toString()}`);
    // Если за время fetch юзер ушёл из browse (state.allList сбросили в
    // runSearch/showAllInCategory), не дорисовываем чужие строки в #results.
    if (state.allList !== a) return;
    if (!res.ok) throw new Error("search_failed");
    const data = await res.json();
    if (state.allList !== a) return;
    const items = data.items || [];
    const root = $("#results");
    items.forEach(it => root.appendChild(specRow(it)));
    a.offset += items.length;
    if (items.length === 0 || a.offset >= a.total) {
      a.done = true;
      renderSimilarSection();
    }
  } catch (_) {
    a.done = true;
  } finally {
    a.loading = false;
    $("#results-loading").classList.add("hidden");
  }
}

function renderSimilarSection() {
  const a = state.allList;
  if (!a || a.similarRendered) return;
  if (!a.similar || !a.similar.length) { a.similarRendered = true; return; }
  const root = $("#results");
  const sep = document.createElement("div");
  sep.className = "results-similar-header";
  sep.textContent = `Похожие специалисты — ${relaxedLabel(a.relaxed)}`;
  root.appendChild(sep);
  a.similar.forEach(it => {
    const row = specRow(it);
    row.classList.add("similar");
    root.appendChild(row);
  });
  a.similarRendered = true;
}

let allListObserver = null;
function ensureAllListObserver() {
  if (allListObserver) return;
  const sentinel = $("#results-sentinel");
  if (!sentinel) return;
  allListObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting && state.allList && !state.allList.done && !state.allList.loading) {
        loadNextAllPage();
      }
    }
  }, { rootMargin: "300px 0px" });
  allListObserver.observe(sentinel);
}

function renderFacets(facets, activeCodes) {
  const root = $("#results-facets");
  root.innerHTML = "";
  const items = facets && Array.isArray(facets.categories) ? facets.categories : [];
  if (items.length === 0) return;

  const active = new Set(activeCodes || []);
  const order = new Map(state.categories.map((c, i) => [c.code, i]));
  const sorted = items
    .filter(c => order.has(c.code))
    .sort((a, b) => order.get(a.code) - order.get(b.code));

  sorted.forEach(c => {
    const cat = state.categories.find(x => x.code === c.code);
    if (!cat) return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "facet-chip" + (active.has(c.code) ? " active" : "");
    chip.innerHTML = `${escape(cat.title)} <span class="facet-count">${c.count}</span>`;
    chip.addEventListener("click", () => {
      if (active.has(c.code)) return;
      const havePicks = state.lastPicks && state.lastPicks.length > 0 && state.lastPicksMeta;
      showAllInCategory(cat, havePicks
        ? { backTo: "picks", keepClarify: true }
        : {});
    });
    root.appendChild(chip);
  });
}

function setSummary(text, note) {
  const sum = $("#results-summary");
  sum.innerHTML = "";
  if (note) {
    const b = document.createElement("div");
    b.className = "results-banner";
    b.textContent = note;
    sum.appendChild(b);
  }
  if (text) {
    const t = document.createElement("div");
    t.className = "results-text";
    t.textContent = text;
    sum.appendChild(t);
  }
}

function renderShowAllCTA(totalInCategory, picksCount) {
  const cat = state.currentCategory;
  const params = (state.lastPicksMeta && state.lastPicksMeta.searchParams) || state.pendingSearch;
  if (!cat && !params) return;

  const total = Number.isFinite(totalInCategory) ? totalInCategory : 0;
  const text = total > picksCount
    ? `Мы выбрали <b>${picksCount}</b> из ${total}.`
    : `Мы выбрали <b>${picksCount}</b> специалистов.`;

  const sum = $("#results-summary");
  const wrap = document.createElement("div");
  wrap.className = "results-cta";
  wrap.innerHTML = `
    <div class="results-cta-text">${text}</div>
    <button class="results-cta-btn" type="button">Посмотреть всех в категории →</button>
  `;
  wrap.querySelector(".results-cta-btn").addEventListener("click",
    () => cat
      ? showAllInCategory(cat, { backTo: "picks", keepClarify: true })
      : showAllForFreeform(params));
  sum.appendChild(wrap);
}

async function showAllForFreeform(params) {
  syncURL("/search" + buildSearchQs(params));
  showView("results");
  setResultsBack("clarify", "уточнить запрос");
  // Дескриптор: feed→back должен вернуть в тот же free-form список,
  // а не в AI-подбор (даже если lastPicks остались с keepClarify).
  state.lastListView = { kind: "all-by-q", params };
  state.lastBrowseParams = params;
  setResultsViewToggleVisible(true);
  $("#results-title").textContent = "Все совпадения по запросу";
  setSummary("Загружаем все совпадения…", "");
  $("#results").innerHTML = "";
  $("#results-facets").innerHTML = "";
  await renderAllInCategory(params, "");
}

function renderResults(items, similar = [], relaxed = []) {
  const root = $("#results");
  root.innerHTML = "";
  if (!items.length && !similar.length) {
    root.innerHTML = `<div class="empty">Никого не нашлось. Попробуйте смягчить запрос или другую категорию.</div>`;
    return;
  }
  items.forEach(it => root.appendChild(specCard(it)));
  if (similar.length) {
    const sep = document.createElement("div");
    sep.className = "results-similar-header";
    sep.textContent = `Похожие специалисты — ${relaxedLabel(relaxed)}`;
    root.appendChild(sep);
    similar.forEach(it => {
      const card = specCard(it);
      card.classList.add("similar");
      root.appendChild(card);
    });
  }
}

function relaxedLabel(relaxed) {
  const map = { city: "без учёта города", rate: "без учёта бюджета" };
  const parts = (relaxed || []).map(r => map[r] || r);
  return parts.length ? `расширили поиск ${parts.join(", ")}` : "расширили поиск";
}

/* ───── component: compact spec row (browse-list view) ──────────
   Одна строка на спеца: avatar + name/meta + rate + cart-button.
   Используется в renderAllInCategory/loadNextAllPage. AI-flow рисует
   богатые карточки через specCard ниже. */

// renderSkillChips — превращает skill_slugs в HTML-набор чипов с лимитом
// (после лимита — «+N»). Возвращает "" если скиллов нет вовсе. limit < 0
// = без обрезания.
function renderSkillChips(slugs, limit) {
  if (!slugs || !slugs.length) return "";
  const all = slugs.map(s => skillTitle(s)).filter(Boolean);
  if (!all.length) return "";
  const visible = limit > 0 ? all.slice(0, limit) : all;
  const rest = all.length - visible.length;
  const chips = visible.map(t => `<span class="skill-tag">${escape(t)}</span>`).join("");
  const more = rest > 0 ? `<span class="skill-tag skill-tag-more">+${rest}</span>` : "";
  return chips + more;
}

function specRow(it) {
  const row = document.createElement("div");
  row.className = "spec-row";
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  const rate = formatRate(it.rate_min, it.rate_max, it.currency);
  const ratingMeta = it.reviews_count
    ? `★ ${(it.rating_avg || 0).toFixed(1)} · ${it.reviews_count}`
    : "новый";
  const primary = it.primary_category || (it.categories && it.categories[0]);
  const catChip = primary
    ? `<span class="spec-row-cat">${escape(categoryTitle(primary))}</span>`
    : "";
  const initial = (it.display_name || "?").trim().charAt(0).toUpperCase();
  const avatar = it.avatar_url
    ? `<img class="spec-row-avatar" src="${escape(it.avatar_url)}" alt="" loading="lazy" />`
    : `<div class="spec-row-avatar spec-row-avatar-fallback">${escape(initial)}</div>`;

  // Скиллы: первые 4 чипа + «+N», чтобы не разрывать строку у тех, у кого
  // выбрано 10 платформ. Слаги, тайтлы — из state.skills.
  const skillChips = renderSkillChips(it.skill_slugs || [], 4);

  row.innerHTML = `
    ${avatar}
    <div class="spec-row-main">
      <div class="spec-row-name">${escape(it.display_name)}</div>
      <div class="spec-row-meta">
        ${catChip}
        <span class="spec-row-city">${escape(it.city || "удалённо")}</span>
        <span class="spec-row-rating">${escape(ratingMeta)}</span>
      </div>
      ${skillChips ? `<div class="spec-row-skills">${skillChips}</div>` : ""}
    </div>
    <div class="spec-row-side">
      <div class="spec-row-rate">${escape(rate)}</div>
      <button class="btn-cart" data-cart-toggle="${escape(it.user_id)}">${inCart(it.user_id) ? "В проекте ✓" : "+ В проект"}</button>
    </div>
  `;
  const cartBtn = row.querySelector(".btn-cart");
  cartBtn.classList.toggle("in-cart", inCart(it.user_id));
  cartBtn.addEventListener("click", e => {
    e.stopPropagation();
    toggleCart(it, cartBtn);
  });
  row.addEventListener("click", () => gotoSpecialist(it));
  row.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      gotoSpecialist(it);
    }
  });
  return row;
}

/* ───── component: rich spec card (AI-picks view) ────────────── */

function specCard(it) {
  const card = document.createElement("div");
  card.className = "spec-card" + (it._reason ? " pick" : "");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  const rate = formatRate(it.rate_min, it.rate_max, it.currency);
  const cats = (it.categories || []).map(c => `<span class="tag-chip">${escape(categoryTitle(c))}</span>`).join("");
  const skills = renderSkillChips(it.skill_slugs || [], 6);
  const ratingMeta = it.reviews_count
    ? `★ ${(it.rating_avg || 0).toFixed(1)} · ${it.reviews_count} отз.`
    : "новый специалист";
  card.innerHTML = `
    <div class="spec-main">
      <div class="spec-name">${escape(it.display_name)}</div>
      <div class="spec-meta">${escape(it.city || "удалённо")} · ${ratingMeta}</div>
      ${it._reason ? `<div class="spec-pick-reason">${escape(it._reason)}</div>` : ""}
      <div class="spec-bio">${escape(it.bio || "")}</div>
      <div class="tags">${cats}</div>
      ${skills ? `<div class="tags spec-skills">${skills}</div>` : ""}
    </div>
    <div class="spec-side">
      <div class="rate">${rate}</div>
      <button class="btn-cart" data-cart-toggle="${escape(it.user_id)}">${inCart(it.user_id) ? "В проекте ✓" : "В проект"}</button>
    </div>
  `;
  const cartBtn = card.querySelector(".btn-cart");
  cartBtn.classList.toggle("in-cart", inCart(it.user_id));
  cartBtn.addEventListener("click", e => {
    e.stopPropagation();
    toggleCart(it, cartBtn);
  });
  card.addEventListener("click", () => gotoSpecialist(it));
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      gotoSpecialist(it);
    }
  });
  return card;
}
