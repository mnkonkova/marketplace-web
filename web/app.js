/* ──────────────────────────────────────────────────────────────────
   marketpclce — UI слой, компонентный рендер
   API/state-machine не трогаем; меняется только визуальный слой.
   ────────────────────────────────────────────────────────────────── */

const API = "/api/v1";

const state = {
  categories: [],
  categoryCounts: {},
  currentCategory: null,
  chatHistory: [],
  pendingSearch: null,
  lastResults: [],
  lastSummary: "",
  lastPicks: [],
  lastPicksMeta: null,
  allList: null,
  cart: loadCart(),
};

const CART_KEY = "marketpclce.cart.v1";
const AUTH_KEY = "marketpclce.auth.v1";

const ICONS = {
  editor: "🎬", video_director: "🎞️", motion: "✨", scriptwriter: "✍️",
  smm: "📱", ugc: "📸", blogger: "🌟", ads_seo: "🎯", seeding: "🌱",
};

// короткие тайтлы для компактных плиток bento (полное название всё равно
// видно в aria-label, в описании, в clarify и в результатах)
const SHORT_TITLES = {
  video_director: "Видеорежиссёр",
};
function tileTitle(cat) {
  return SHORT_TITLES[cat.code] || cat.title;
}

// все плитки одного размера — симметричная сетка

/* ───── helpers ────────────────────────────────────────────────── */

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function fmt(n) { return new Intl.NumberFormat("ru-RU").format(n); }

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (_) {}
}
function inCart(userId) { return state.cart.some(s => s.user_id === userId); }
function addToCart(spec) {
  if (inCart(spec.user_id)) return;
  state.cart.push({
    user_id: spec.user_id,
    display_name: spec.display_name,
    city: spec.city,
    rate_min: spec.rate_min,
    rate_max: spec.rate_max,
    currency: spec.currency,
  });
  saveCart(); renderCartButton(); syncCartButtons();
}
function removeFromCart(userId) {
  state.cart = state.cart.filter(s => s.user_id !== userId);
  saveCart(); renderCartButton(); syncCartButtons(); renderCartItems();
}
function clearCart() {
  state.cart = [];
  saveCart(); renderCartButton(); syncCartButtons(); renderCartItems();
}

function showView(name) {
  ["roadmap", "clarify", "results", "profile", "me"].forEach(v => {
    $(`#view-${v}`).classList.toggle("hidden", v !== name);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ───── auth ───────────────────────────────────────────────────── */

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.access_token || !p.refresh_token) return null;
    return p;
  } catch (_) { return null; }
}
function saveAuth(pair, kind) {
  const cur = loadAuth() || {};
  const next = {
    access_token: pair.access_token,
    refresh_token: pair.refresh_token,
    kind: kind || cur.kind || "",
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(next));
  syncAuthUI();
}
function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  syncAuthUI();
}
function isLoggedIn() { return !!loadAuth(); }

async function authFetch(url, opts = {}) {
  const h = new Headers(opts.headers || {});
  const a = loadAuth();
  if (a) h.set("Authorization", `Bearer ${a.access_token}`);
  let res = await fetch(url, { ...opts, headers: h });
  if (res.status !== 401 || !a) return res;
  // try refresh once
  const r = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: a.refresh_token }),
  });
  if (!r.ok) {
    clearAuth();
    return res;
  }
  const pair = await r.json();
  saveAuth(pair);
  h.set("Authorization", `Bearer ${pair.access_token}`);
  res = await fetch(url, { ...opts, headers: h });
  return res;
}

function syncAuthUI() {
  const a = loadAuth();
  const meBtn = $("#me-btn");
  const authBtn = $("#auth-btn");
  if (!meBtn || !authBtn) return;
  if (a) {
    meBtn.classList.remove("hidden");
    authBtn.classList.add("hidden");
  } else {
    meBtn.classList.add("hidden");
    authBtn.classList.remove("hidden");
  }
}

function pluralSpecialists(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} специалист`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} специалиста`;
  return `${n} специалистов`;
}
function specialistsWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "специалист";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "специалиста";
  return "специалистов";
}

function categoryTitle(code) {
  const c = state.categories.find(x => x.code === code);
  return c ? c.title : code;
}

function formatRate(min, max, cur) {
  cur = cur || "RUB";
  if (min == null && max == null) return "ставка по договорённости";
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)} ${cur}`;
  if (min != null) return `от ${fmt(min)} ${cur}`;
  return `до ${fmt(max)} ${cur}`;
}

const ARROW_SVG =
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
     <path d="M5 12h14M13 6l6 6-6 6"/>
   </svg>`;

/* ───── categories load ─────────────────────────────────────────── */

async function loadCategories() {
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
  renderRoadmap();
}

/* ───── component: symmetric category tile ────────────────────── */

function categoryCardEl(cat, count, { index = 0 } = {}) {
  // div, не button: внутри лежит вложенная кнопка "все N"
  const card = document.createElement("div");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.className = "cat-card group";
  card.setAttribute("aria-label", `${cat.title} — подобрать специалистов`);

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
      <div class="text-[20px] md:text-[22px] font-semibold tracking-tight text-white leading-[1.1] line-clamp-2">
        ${escape(tileTitle(cat))}
      </div>
      <p class="cat-desc-hover text-[12px] text-white/60 leading-snug line-clamp-3">${escape(cat.description || "")}</p>
    </div>

    <div class="flex items-center justify-between gap-3 pt-3 border-t border-white/[0.05]">
      <span class="cat-primary-cta">[ Подобрать → ]</span>
      ${count > 0 ? `<button type="button" class="cat-show-all-link">[ все ${count} ]</button>` : `<span class="text-[10px] uppercase tracking-overline text-white/30">${escape(countText)}</span>`}
    </div>
  `;

  card.addEventListener("click", e => {
    if (e.target.closest(".cat-show-all-link")) return;
    openClarify(cat);
  });
  card.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && !e.target.closest(".cat-show-all-link")) {
      e.preventDefault();
      openClarify(cat);
    }
  });

  const showAll = card.querySelector(".cat-show-all-link");
  if (showAll) {
    showAll.addEventListener("click", e => {
      e.stopPropagation();
      e.preventDefault();
      if (count > 0) showAllInCategory(cat);
    });
  }

  return card;
}

function renderRoadmap() {
  const root = $("#roadmap");
  root.innerHTML = "";
  state.categories.forEach((cat, idx) => {
    const count = state.categoryCounts[cat.code] || 0;
    root.appendChild(categoryCardEl(cat, count, { index: idx }));
  });
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

async function showAllSpecialists() {
  state.currentCategory = null;
  state.chatHistory = [];
  state.pendingSearch = null;
  state.lastPicks = [];
  state.lastPicksMeta = null;
  showView("results");
  setResultsBack("roadmap", "на главную");
  $("#results-title").textContent = "Все специалисты";
  setSummary("Загружаем каталог…", "");
  $("#results").innerHTML = "";
  $("#results-facets").innerHTML = "";
  await renderAllInCategory({ categories: [] }, "");
}

/* ───── clarify (chat) ─────────────────────────────────────────── */

function openClarify(category, opts = {}) {
  const { initialUserText = "" } = opts;
  state.currentCategory = category;
  state.chatHistory = [];
  state.pendingSearch = null;
  $("#clarify-title").textContent = category
    ? `Уточняем: ${category.title}`
    : "Свободный поиск";
  $("#chat").innerHTML = "";
  $("#run-search").classList.add("hidden");
  $("#chat-input").value = "";
  showView("clarify");

  if (initialUserText) {
    sendChat(initialUserText);
    return;
  }

  appendMsg("assistant", category
    ? `Задача в категории «${category.title}». В двух словах — для какой платформы и какой формат? Можно сразу указать бюджет и сроки.`
    : "Опишите вашу задачу одной фразой — например, «нужен монтажёр для Reels по фитнесу, бюджет до 30 000».");
  $("#chat-input").focus();
}

function appendMsg(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  $("#chat").appendChild(el);
  $("#chat").scrollTop = $("#chat").scrollHeight;
  return el;
}

function appendTyping() {
  const el = document.createElement("div");
  el.className = "msg assistant";
  el.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
  $("#chat").appendChild(el);
  $("#chat").scrollTop = $("#chat").scrollHeight;
  return el;
}

async function sendChat(text) {
  state.chatHistory.push({ role: "user", content: text });
  appendMsg("user", text);
  $("#chat-input").value = "";
  $("#chat-input").disabled = true;

  const typing = appendTyping();
  try {
    const res = await fetch(`${API}/clarify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: state.currentCategory ? state.currentCategory.code : "",
        history: state.chatHistory,
      }),
    });
    typing.remove();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.error === "llm_disabled") {
        appendMsg("assistant", "ИИ-уточнение временно недоступно — переходим к поиску по вашему запросу.");
        state.pendingSearch = {
          q: text,
          categories: state.currentCategory ? [state.currentCategory.code] : [],
          skills: [], city: "",
        };
        $("#run-search").classList.remove("hidden");
        return;
      }
      throw new Error(err.error || "clarify_failed");
    }
    const data = await res.json();
    appendMsg("assistant", data.message || "");
    state.chatHistory.push({ role: "assistant", content: data.message || "" });
    if (data.done && data.search) {
      state.pendingSearch = data.search;
      $("#run-search").classList.remove("hidden");
    }
  } catch (e) {
    typing.remove();
    const el = appendMsg("assistant", `Не получилось уточнить: ${e.message}. Попробуйте всё-таки запустить поиск.`);
    el.classList.add("error");
    state.pendingSearch = {
      q: text,
      categories: state.currentCategory ? [state.currentCategory.code] : [],
      skills: [], city: "",
    };
    $("#run-search").classList.remove("hidden");
  } finally {
    $("#chat-input").disabled = false;
    $("#chat-input").focus();
  }
}

/* ───── results ────────────────────────────────────────────────── */

async function runSearch() {
  const params = state.pendingSearch || {
    q: "", categories: state.currentCategory ? [state.currentCategory.code] : [],
    skills: [], city: "",
  };

  showView("results");
  setResultsBack("clarify", "уточнить запрос");
  $("#results-title").textContent = state.currentCategory
    ? state.currentCategory.title
    : "Подбор по запросу";
  setSummary("Запрашиваем подбор у ИИ…", "");
  $("#results").innerHTML = "";
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
        };
        const note = data.broadened
          ? "По исходному запросу ничего не нашлось точно, ИИ подобрал из всей категории."
          : "";
        setSummary(state.lastSummary, note);
        renderShowAllCTA(data.total_in_category, data.picks.length);
        renderResults(state.lastPicks.map(p => ({ ...p.profile, _reason: p.reason })));
        return;
      }
    }

    await renderAllInCategory(params, fallbackBanner("AI ничего точного не нашёл"));
  } catch (e) {
    await renderAllInCategory(params, fallbackBanner(`Поиск с ИИ недоступен (${e.message})`));
  }
}

function fallbackBanner(prefix) {
  return state.currentCategory
    ? `${prefix} — показываем всех в категории «${state.currentCategory.title}».`
    : `${prefix} — показываем всех специалистов каталога.`;
}

async function showAllInCategory(category, opts = {}) {
  const { backTo = "roadmap", keepClarify = false } = opts;
  state.currentCategory = category;
  if (!keepClarify) {
    state.chatHistory = [];
    state.pendingSearch = null;
    state.lastPicks = [];
    state.lastPicksMeta = null;
  }
  showView("results");
  const labels = { roadmap: "на главную", clarify: "уточнить запрос", picks: "к подбору ИИ" };
  setResultsBack(backTo, labels[backTo] || "назад");
  $("#results-title").textContent = category.title;
  setSummary("Загружаем всех специалистов в категории…", "");
  $("#results").innerHTML = "";
  $("#results-facets").innerHTML = "";
  await renderAllInCategory({ categories: [category.code] }, "");
}

function restoreAiPicks() {
  const meta = state.lastPicksMeta;
  if (!state.lastPicks || !state.lastPicks.length || !meta) {
    showView("clarify");
    return;
  }
  state.allList = null;
  state.currentCategory = meta.category || state.currentCategory;
  showView("results");
  setResultsBack("clarify", "уточнить запрос");
  $("#results-title").textContent = state.currentCategory ? state.currentCategory.title : "Подбор по запросу";
  $("#results-facets").innerHTML = "";
  const note = meta.broadened
    ? "По исходному запросу ничего не нашлось, ИИ подобрал из всей категории."
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
    items.forEach(it => root.appendChild(specCard(it)));
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
    if (!res.ok) throw new Error("search_failed");
    const data = await res.json();
    const items = data.items || [];
    const root = $("#results");
    items.forEach(it => root.appendChild(specCard(it)));
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
    const card = specCard(it);
    card.classList.add("similar");
    root.appendChild(card);
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
  if (!cat || !totalInCategory || totalInCategory <= picksCount) return;
  const sum = $("#results-summary");
  const wrap = document.createElement("div");
  wrap.className = "results-cta";
  wrap.innerHTML = `
    <div class="results-cta-text">ИИ выбрал <b>${picksCount}</b> из ${totalInCategory} в категории «${escape(cat.title)}».</div>
    <button class="results-cta-btn" type="button">Смотреть всех ${totalInCategory} →</button>
  `;
  wrap.querySelector(".results-cta-btn").addEventListener("click",
    () => showAllInCategory(cat, { backTo: "picks", keepClarify: true }));
  sum.appendChild(wrap);
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

/* ───── component: spec card ───────────────────────────────────── */

function specCard(it) {
  const card = document.createElement("div");
  card.className = "spec-card" + (it._reason ? " pick" : "");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  const rate = formatRate(it.rate_min, it.rate_max, it.currency);
  const cats = (it.categories || []).map(c => `<span class="tag-chip">${escape(categoryTitle(c))}</span>`).join("");
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
  card.addEventListener("click", () => openSpecialist(it));
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSpecialist(it);
    }
  });
  return card;
}

/* ───── profile ────────────────────────────────────────────────── */

async function openSpecialist(spec) {
  showView("profile");
  const root = $("#profile-content");
  root.innerHTML = renderProfile(spec, null);
  bindProfileActions(spec);
  try {
    const res = await fetch(`${API}/specialists/${spec.user_id}`);
    if (!res.ok) throw new Error("not_found");
    const full = await res.json();
    root.innerHTML = renderProfile({ ...spec, ...full }, full);
    bindProfileActions(full);
  } catch (_) {
    /* fallback на лёгкую карточку */
  }
}

function renderProfile(spec, full) {
  const rate = formatRate(spec.rate_min, spec.rate_max, spec.currency);
  const ratingMeta = spec.reviews_count
    ? `★ ${(spec.rating_avg || 0).toFixed(1)} · ${spec.reviews_count} отз.`
    : "новый специалист";
  const initials = (spec.display_name || "?").trim().slice(0, 1).toUpperCase();
  const avatar = spec.avatar_url
    ? `<img src="${escape(spec.avatar_url)}" alt="" />`
    : escape(initials);

  const cats = full && full.categories
    ? full.categories.map(c => `<span class="profile-chip${c.is_primary ? " primary" : ""}">${escape(c.title)}</span>`).join("")
    : (spec.categories || []).map(c => `<span class="profile-chip">${escape(categoryTitle(c))}</span>`).join("");

  const skills = full && full.skills && full.skills.length
    ? `<div class="profile-section">
         <h3>Навыки</h3>
         <div class="profile-chips">${full.skills.map(s => `<span class="profile-chip">${escape(s.title)}</span>`).join("")}</div>
       </div>`
    : "";

  const portfolio = full && full.portfolio && full.portfolio.length
    ? `<div class="profile-section">
         <h3>Портфолио</h3>
         <div class="portfolio-grid">${full.portfolio.map(renderPortfolioItem).join("")}</div>
       </div>`
    : "";

  const reviews = full && full.reviews && full.reviews.length
    ? `<div class="profile-section">
         <h3>Отзывы${spec.reviews_count ? ` <span class="reviews-count">· ${spec.reviews_count}</span>` : ""}</h3>
         <div class="reviews-list">${full.reviews.map(renderReviewItem).join("")}</div>
       </div>`
    : "";

  const reasonBlock = spec._reason
    ? `<div class="spec-pick-reason" style="margin-top:14px">${escape(spec._reason)}</div>`
    : "";

  const bioBlock = spec.bio
    ? `<div class="profile-section">
         <h3>О специалисте</h3>
         <div class="profile-bio">${escape(spec.bio)}</div>
       </div>`
    : "";

  return `
    <article class="profile-card">
      <div class="profile-top">
        <div class="profile-avatar">${avatar}</div>
        <div class="profile-ident">
          <div class="profile-name">${escape(spec.display_name || "")}</div>
          <div class="profile-meta">${escape(spec.city || "удалённо")} · ${ratingMeta}</div>
          ${cats ? `<div class="profile-chips" style="margin-top:8px">${cats}</div>` : ""}
        </div>
      </div>
      <div class="profile-side">
        <div class="profile-rate">${rate}</div>
        <button class="btn-cart${inCart(spec.user_id) ? " in-cart" : ""}" data-cart-toggle="${escape(spec.user_id)}">${inCart(spec.user_id) ? "В проекте ✓" : "В проект"}</button>
      </div>
    </article>
    ${reasonBlock}
    ${bioBlock}
    ${skills}
    ${portfolio}
    ${reviews}
  `;
}

function renderReviewItem(rev) {
  const stars = "★".repeat(rev.rating) + "☆".repeat(Math.max(0, 5 - rev.rating));
  let dateLabel = "";
  if (rev.created_at) {
    try {
      dateLabel = new Date(rev.created_at).toLocaleDateString("ru-RU", { year: "numeric", month: "long" });
    } catch (_) {}
  }
  return `
    <div class="review-card">
      <div class="review-head">
        <span class="review-stars" aria-label="Оценка ${rev.rating} из 5">${stars}</span>
        <span class="review-author">${escape(rev.author_name || "Клиент")}</span>
        ${dateLabel ? `<span class="review-date">${escape(dateLabel)}</span>` : ""}
      </div>
      ${rev.text ? `<div class="review-text">${escape(rev.text)}</div>` : ""}
    </div>
  `;
}

function renderPortfolioItem(p) {
  const href = p.external_url || p.video_url || "";
  const tag = href ? "a" : "div";
  const attrs = href ? `href="${escape(href)}" target="_blank" rel="noopener noreferrer"` : "";
  const thumbStyle = p.thumbnail_url
    ? `background-image:url('${escape(p.thumbnail_url)}')`
    : "";
  const thumbContent = p.thumbnail_url ? "" : (p.video_url ? "▶" : "🖼");
  return `
    <${tag} class="portfolio-card" ${attrs}>
      <div class="portfolio-thumb" style="${thumbStyle}">${thumbContent}</div>
      <div class="portfolio-body">
        <div class="portfolio-title">${escape(p.title || "")}</div>
        ${p.description ? `<div class="portfolio-desc">${escape(p.description)}</div>` : ""}
      </div>
    </${tag}>
  `;
}

function bindProfileActions(spec) {
  const btn = document.querySelector('#profile-content .btn-cart');
  if (!btn) return;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    toggleCart(spec, btn);
  });
}

function toggleCart(spec, btn) {
  if (inCart(spec.user_id)) removeFromCart(spec.user_id);
  else addToCart(spec);
  if (btn) updateCartButton(btn, spec.user_id);
}

function updateCartButton(btn, userId) {
  const inside = inCart(userId);
  btn.textContent = inside ? "В проекте ✓" : "В проект";
  btn.classList.toggle("in-cart", inside);
}

function syncCartButtons() {
  document.querySelectorAll("[data-cart-toggle]").forEach(btn => {
    updateCartButton(btn, btn.getAttribute("data-cart-toggle"));
  });
}

/* ───── cart dialog ────────────────────────────────────────────── */

function renderCartButton() {
  const btn = $("#cart-btn");
  if (!btn) return;
  const count = state.cart.length;
  $("#cart-count").textContent = String(count);
  btn.classList.toggle("is-empty", count === 0);
}

function openCartDialog() {
  renderCartItems();
  $("#cart-dialog").showModal();
}

function renderCartItems() {
  const root = $("#cart-items");
  if (!root) return;
  root.innerHTML = "";
  if (state.cart.length === 0) {
    root.innerHTML = `<div class="cart-empty">Проект пуст — добавляйте подходящих специалистов кнопкой «В проект».</div>`;
    $("#cart-checkout").disabled = true;
    $("#cart-total").classList.add("hidden");
    return;
  }
  $("#cart-checkout").disabled = false;
  state.cart.forEach(s => {
    const item = document.createElement("div");
    item.className = "cart-item";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", `Открыть профиль: ${s.display_name || ""}`);
    const rate = formatRate(s.rate_min, s.rate_max, s.currency);
    item.innerHTML = `
      <div>
        <div class="cart-item-name">${escape(s.display_name || "")}</div>
        <div class="cart-item-meta">${escape(s.city || "удалённо")}</div>
      </div>
      <div class="cart-item-rate">${escape(rate)}</div>
      <button class="cart-item-remove" type="button">Убрать</button>
    `;
    item.querySelector(".cart-item-remove").addEventListener("click", e => {
      e.stopPropagation();
      removeFromCart(s.user_id);
    });
    const open = () => {
      $("#cart-dialog").close();
      openSpecialist(s);
    };
    item.addEventListener("click", open);
    item.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    root.appendChild(item);
  });
  renderCartTotal();
}

function renderCartTotal() {
  const wrap = $("#cart-total");
  if (!wrap) return;
  if (state.cart.length === 0) {
    wrap.classList.add("hidden");
    return;
  }
  const totals = computeCartTotal(state.cart);
  $("#cart-total-value").textContent = totals.label;
  const note = $("#cart-total-note");
  note.textContent = totals.note || "";
  note.classList.toggle("hidden", !totals.note);
  wrap.classList.remove("hidden");
}

function computeCartTotal(cart) {
  const buckets = new Map();
  let unspecified = 0;
  for (const s of cart) {
    const min = s.rate_min, max = s.rate_max;
    if (min == null && max == null) { unspecified++; continue; }
    const cur = s.currency || "RUB";
    const b = buckets.get(cur) || { min: 0, max: 0, hasMin: false, hasMax: false };
    const lo = min != null ? min : max;
    const hi = max != null ? max : min;
    b.min += lo; b.max += hi;
    b.hasMin = b.hasMin || min != null;
    b.hasMax = b.hasMax || max != null;
    buckets.set(cur, b);
  }
  if (buckets.size === 0) return { label: "по договорённости", note: "" };
  const parts = [];
  for (const [cur, b] of buckets) {
    parts.push(b.min === b.max ? `${fmt(b.min)} ${cur}` : `${fmt(b.min)}–${fmt(b.max)} ${cur}`);
  }
  let note = "";
  if (unspecified > 0) note = `+ ${unspecified} ${specialistsWord(unspecified)} с ставкой по договорённости`;
  return { label: parts.join(" + "), note };
}

/* ───── lead dialog ────────────────────────────────────────────── */

function openLeadDialog() {
  if (state.cart.length === 0) return;
  const target = $("#lead-target");
  target.innerHTML = "";
  const head = document.createElement("div");
  head.textContent = `Получатели (${state.cart.length}):`;
  target.appendChild(head);
  const list = document.createElement("ul");
  list.className = "lead-target-list";
  state.cart.forEach(s => {
    const li = document.createElement("li");
    li.textContent = `· ${s.display_name}`;
    list.appendChild(li);
  });
  target.appendChild(list);
  $("#lead-error").classList.add("hidden");
  $("#lead-dialog").showModal();
}

async function submitLead(form) {
  if (state.cart.length === 0) {
    $("#lead-error").textContent = "Проект пуст";
    $("#lead-error").classList.remove("hidden");
    return;
  }
  const data = new FormData(form);
  const payload = {
    client_name: data.get("client_name"),
    client_contact: data.get("client_contact"),
    brief: data.get("brief"),
    target_category: state.currentCategory ? state.currentCategory.code : "",
    specialist_ids: state.cart.map(s => s.user_id),
  };
  const bmin = data.get("budget_min");
  const bmax = data.get("budget_max");
  if (bmin) payload.budget_min = +bmin;
  if (bmax) payload.budget_max = +bmax;
  const dl = data.get("deadline");
  if (dl) payload.deadline = dl;

  const res = await fetch(`${API}/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    $("#lead-error").textContent = `Ошибка: ${err.error || res.status}`;
    $("#lead-error").classList.remove("hidden");
    return;
  }
  const recipients = state.cart.map(s => s.display_name).join(", ");
  $("#lead-dialog").close();
  $("#lead-success-text").textContent =
    `Заявка отправлена (${state.cart.length}): ${recipients}. Бриф ушёл специалистам, ответят на ${payload.client_contact}.`;
  $("#lead-success").showModal();
  form.reset();
  clearCart();
}

/* ───── hero handlers ──────────────────────────────────────────── */

function submitHero() {
  const text = $("#hero-input").value.trim();
  if (!text) return;
  $("#hero-input").value = "";
  openClarify(null, { initialUserText: text });
}

/* ───── boot ───────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  renderCartButton();

  loadCategories().catch(e => {
    $("#roadmap").innerHTML = `<div class="empty col-span-full">Не удалось загрузить категории: ${e.message}</div>`;
  });

  // hero form
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

  // chat в clarify
  $("#chat-form").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("#chat-input").value.trim();
    if (text) sendChat(text);
  });

  $("#run-search").addEventListener("click", runSearch);
  $("#cart-btn").addEventListener("click", openCartDialog);

  const showAllBtn = $("#show-all-specialists");
  if (showAllBtn) showAllBtn.addEventListener("click", showAllSpecialists);

  // глобальный обработчик data-action кнопок
  document.body.addEventListener("click", e => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    switch (t.dataset.action) {
      case "back-roadmap": showView("roadmap"); break;
      case "back-clarify": showView("clarify"); break;
      case "back-results": showView("results"); break;
      case "back-picks":   restoreAiPicks(); break;
      case "cancel-lead":  $("#lead-dialog").close(); break;
      case "close-success": $("#lead-success").close(); break;
      case "cart-close":   $("#cart-dialog").close(); break;
      case "cart-clear":   clearCart(); break;
      case "cart-checkout":
        if (state.cart.length === 0) return;
        $("#cart-dialog").close();
        openLeadDialog();
        break;
      case "open-auth":    openAuthDialog("login"); break;
      case "close-auth":   $("#auth-dialog").close(); break;
      case "open-me":      openMe(); break;
      case "logout":       logout(); break;
      case "me-publish":   saveMeProfile({ publish: true }); break;
      case "me-unpublish": unpublishMe(); break;
      case "me-view-public":
        if (state.me && state.me.user_id) openSpecialist({ user_id: state.me.user_id, display_name: state.me.display_name });
        break;
    }
  });

  $("#lead-form").addEventListener("submit", e => {
    e.preventDefault();
    submitLead(e.target);
  });

  bindAuthDialog();
  bindMeForm();
  syncAuthUI();
});

/* ───── auth dialog ────────────────────────────────────────────── */

function openAuthDialog(tab) {
  setAuthTab(tab || "login");
  $("#login-error").classList.add("hidden");
  $("#register-error").classList.add("hidden");
  $("#auth-dialog").showModal();
}

function setAuthTab(tab) {
  $("#login-form").classList.toggle("hidden", tab !== "login");
  $("#login-form").classList.toggle("flex", tab === "login");
  $("#register-form").classList.toggle("hidden", tab !== "register");
  $("#register-form").classList.toggle("flex", tab === "register");
  ["login", "register"].forEach(t => {
    const btn = document.querySelector(`[data-auth-tab="${t}"]`);
    if (!btn) return;
    const active = t === tab;
    btn.classList.toggle("auth-tab-active", active);
    btn.classList.toggle("border-white/20", active);
    btn.classList.toggle("border-white/10", !active);
    btn.classList.toggle("text-white/60", !active);
  });
}

function bindAuthDialog() {
  $$("[data-auth-tab]").forEach(btn => {
    btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab));
  });

  const reg = $("#register-form");
  const kindSel = reg.querySelector('select[name="kind"]');
  const dispLabel = reg.querySelector(".reg-display-name");
  const dispInput = dispLabel ? dispLabel.querySelector("input") : null;
  const syncDisp = () => {
    const need = kindSel.value === "specialist" || kindSel.value === "both";
    dispLabel.classList.toggle("hidden", !need);
    if (dispInput) dispInput.required = need;
  };
  kindSel.addEventListener("change", syncDisp);
  syncDisp();

  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const data = new FormData(e.target);
    const errEl = $("#login-error");
    errEl.classList.add("hidden");
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          login: String(data.get("login") || "").trim(),
          password: String(data.get("password") || ""),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `http_${res.status}`);
      }
      const pair = await res.json();
      saveAuth(pair);
      $("#auth-dialog").close();
      e.target.reset();
      // если у пользователя есть профиль — сразу в кабинет
      const probe = await authFetch(`${API}/me/profile`);
      if (probe.ok) openMe();
    } catch (err) {
      errEl.textContent = mapAuthError(err.message);
      errEl.classList.remove("hidden");
    }
  });

  $("#register-form").addEventListener("submit", async e => {
    e.preventDefault();
    const data = new FormData(e.target);
    const errEl = $("#register-error");
    errEl.classList.add("hidden");
    const kind = String(data.get("kind") || "client");
    const payload = {
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      password: String(data.get("password") || ""),
      kind,
    };
    if (kind === "specialist" || kind === "both") {
      payload.display_name = String(data.get("display_name") || "").trim();
    }
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `http_${res.status}`);
      }
      const out = await res.json();
      saveAuth(out.tokens, kind);
      $("#auth-dialog").close();
      e.target.reset();
      syncDisp();
      if (kind === "specialist" || kind === "both") openMe();
    } catch (err) {
      errEl.textContent = mapAuthError(err.message);
      errEl.classList.remove("hidden");
    }
  });
}

function mapAuthError(code) {
  switch (code) {
    case "bad_credentials": return "Неверный логин или пароль.";
    case "user_exists":     return "Пользователь с таким email/телефоном уже есть.";
    case "inactive":        return "Аккаунт деактивирован.";
    case "bad_json":        return "Не удалось разобрать запрос.";
    default:
      if (code && code.startsWith("invalid input")) return "Проверьте поля формы.";
      return code ? `Ошибка: ${code}` : "Не получилось.";
  }
}

function logout() {
  clearAuth();
  state.me = null;
  showView("roadmap");
}

/* ───── кабинет (/me) ──────────────────────────────────────────── */

async function openMe() {
  if (!isLoggedIn()) {
    openAuthDialog("login");
    return;
  }
  showView("me");
  resetMeView();
  if (!state.categories.length) {
    try { await loadCategories(); } catch (_) {}
  }
  try {
    const res = await authFetch(`${API}/me/profile`);
    if (res.status === 404) {
      $("#me-no-profile").classList.remove("hidden");
      $("#me-form").classList.add("hidden");
      return;
    }
    if (!res.ok) throw new Error(`http_${res.status}`);
    const profile = await res.json();
    state.me = profile;
    $("#me-no-profile").classList.add("hidden");
    $("#me-form").classList.remove("hidden");
    renderMeForm(profile);
  } catch (err) {
    $("#me-error").textContent = `Не удалось загрузить профиль: ${err.message}`;
    $("#me-error").classList.remove("hidden");
  }
}

function resetMeView() {
  $("#me-no-profile").classList.add("hidden");
  $("#me-form").classList.add("hidden");
  $("#me-error").classList.add("hidden");
  $("#me-saved").classList.add("hidden");
  $("#me-bio-check").classList.add("hidden");
}

function renderMeForm(p) {
  const form = $("#me-form");
  form.elements.display_name.value = p.display_name || "";
  form.elements.city.value = p.city || "";
  form.elements.rate_min.value = p.rate_min == null ? "" : p.rate_min;
  form.elements.rate_max.value = p.rate_max == null ? "" : p.rate_max;
  form.elements.currency.value = p.currency || "RUB";
  form.elements.avatar_url.value = p.avatar_url || "";
  form.elements.bio.value = p.bio || "";
  renderMeStatus(!!p.is_published);
  renderMeCategories(p.categories || [], p.primary_category || "");
}

function renderMeStatus(isPublished) {
  const pill = $("#me-status-pill");
  pill.textContent = isPublished ? "опубликован" : "не опубликован";
  pill.classList.toggle("text-mint-300", isPublished);
  pill.classList.toggle("border-mint-500/40", isPublished);
  const view = $("#me-view-public");
  if (view) view.classList.toggle("hidden", !isPublished);
}

const meSelection = { codes: new Set(), primary: "" };

function renderMeCategories(selected, primary) {
  const root = $("#me-categories");
  root.innerHTML = "";
  meSelection.codes = new Set(selected);
  meSelection.primary = primary || (selected[0] || "");
  if (meSelection.codes.size && !meSelection.codes.has(meSelection.primary)) {
    meSelection.primary = [...meSelection.codes][0];
  }

  state.categories.forEach(cat => {
    const cell = document.createElement("div");
    cell.className = "cat-pick";
    cell.dataset.code = cat.code;
    cell.innerHTML = `
      <button type="button" class="cat-pick-body" data-toggle>
        <span class="cat-pick-title">${escape(cat.title)}</span>
        <span class="cat-pick-desc">${escape(cat.description || "")}</span>
      </button>
      <button type="button" class="cat-pick-star" data-primary aria-label="Сделать основной">★ основная</button>
    `;
    cell.querySelector("[data-toggle]").addEventListener("click", () => toggleMeCategory(cat.code));
    cell.querySelector("[data-primary]").addEventListener("click", () => setMePrimary(cat.code));
    root.appendChild(cell);
    paintMeCategoryCell(cell, cat.code);
  });
}

function toggleMeCategory(code) {
  if (meSelection.codes.has(code)) {
    meSelection.codes.delete(code);
    if (meSelection.primary === code) {
      meSelection.primary = [...meSelection.codes][0] || "";
    }
  } else {
    meSelection.codes.add(code);
    if (!meSelection.primary) meSelection.primary = code;
  }
  repaintMeCategories();
}

function setMePrimary(code) {
  meSelection.codes.add(code);
  meSelection.primary = code;
  repaintMeCategories();
}

function repaintMeCategories() {
  $$("#me-categories .cat-pick").forEach(cell => paintMeCategoryCell(cell, cell.dataset.code));
}

function paintMeCategoryCell(cell, code) {
  const on = meSelection.codes.has(code);
  const isPrimary = meSelection.primary === code && on;
  cell.classList.toggle("is-on", on);
  cell.classList.toggle("is-primary", isPrimary);
}

function bindMeForm() {
  const form = $("#me-form");
  form.addEventListener("submit", e => {
    e.preventDefault();
    saveMeProfile({ publish: false });
  });
  $("#me-check-bio").addEventListener("click", runBioCheck);
}

async function saveMeProfile({ publish }) {
  $("#me-error").classList.add("hidden");
  $("#me-saved").classList.add("hidden");
  $("#me-bio-check").classList.add("hidden");
  const form = $("#me-form");
  const data = new FormData(form);
  const patch = {
    display_name: String(data.get("display_name") || "").trim(),
    bio: String(data.get("bio") || ""),
    avatar_url: String(data.get("avatar_url") || "").trim(),
    city: String(data.get("city") || "").trim(),
    currency: String(data.get("currency") || "RUB").trim().toUpperCase() || "RUB",
  };
  const rmin = data.get("rate_min");
  const rmax = data.get("rate_max");
  patch.rate_min = rmin === "" || rmin == null ? null : Number(rmin);
  patch.rate_max = rmax === "" || rmax == null ? null : Number(rmax);

  if (!patch.display_name) {
    showMeError("Имя/название не может быть пустым.");
    return;
  }
  if (patch.rate_min != null && patch.rate_max != null && patch.rate_min > patch.rate_max) {
    showMeError("Ставка «от» больше «до».");
    return;
  }

  try {
    let res = await authFetch(`${API}/me/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `http_${res.status}`);
    }
    let profile = await res.json();

    if (meSelection.codes.size > 0) {
      res = await authFetch(`${API}/me/profile/categories`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          codes: [...meSelection.codes],
          primary: meSelection.primary || [...meSelection.codes][0],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `http_${res.status}`);
      }
      profile = await res.json();
    }

    if (publish) {
      if (meSelection.codes.size === 0) {
        showMeError("Выберите хотя бы одну категорию перед публикацией.");
        return;
      }
      res = await authFetch(`${API}/me/profile/publish`, { method: "POST" });
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "bio_rejected" && body.check) {
          renderBioCheck(body.check, /*rejected*/ true);
          showMeError("ИИ-проверка не пропустила описание — поправьте и попробуйте снова.");
          return;
        }
        if (body.error === "bio_empty") {
          showMeError("Заполните описание (bio) перед публикацией.");
          return;
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `http_${res.status}`);
      }
      profile = await res.json();
    }

    state.me = profile;
    renderMeForm(profile);
    $("#me-saved").textContent = publish ? "Профиль опубликован." : "Сохранено.";
    $("#me-saved").classList.remove("hidden");
  } catch (err) {
    showMeError(`Не удалось сохранить: ${err.message}`);
  }
}

async function unpublishMe() {
  $("#me-error").classList.add("hidden");
  $("#me-saved").classList.add("hidden");
  try {
    const res = await authFetch(`${API}/me/profile/unpublish`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `http_${res.status}`);
    }
    const profile = await res.json();
    state.me = profile;
    renderMeForm(profile);
    $("#me-saved").textContent = "Снято с публикации.";
    $("#me-saved").classList.remove("hidden");
  } catch (err) {
    showMeError(`Не удалось снять с публикации: ${err.message}`);
  }
}

async function runBioCheck() {
  const bio = $("#me-form").elements.bio.value || "";
  if (!bio.trim()) {
    showMeError("Сначала заполните описание (bio).");
    return;
  }
  const btn = $("#me-check-bio");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Проверяем…";
  try {
    const res = await authFetch(`${API}/me/profile/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio }),
    });
    if (res.status === 503) {
      showMeError("ИИ-проверка временно недоступна (нет ключа провайдера).");
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `http_${res.status}`);
    }
    const result = await res.json();
    renderBioCheck(result, !result.ok);
  } catch (err) {
    showMeError(`Проверка не удалась: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function renderBioCheck(result, rejected) {
  const el = $("#me-bio-check");
  el.classList.remove("hidden");
  el.classList.toggle("rejected", !!rejected);
  el.classList.toggle("ok", !rejected);
  const head = result.ok
    ? `✓ Описание проходит проверку · ${result.score}/100`
    : `✗ Нужно доработать · ${result.score}/100`;
  el.innerHTML = `
    <div class="bio-check-head">${head}</div>
    ${(result.reasons && result.reasons.length)
      ? `<ul class="bio-check-reasons">${result.reasons.map(r => `<li>${escape(r)}</li>`).join("")}</ul>`
      : ""}
    ${result.suggestion ? `<div class="bio-check-suggestion">Совет: ${escape(result.suggestion)}</div>` : ""}
  `;
}

function showMeError(msg) {
  const el = $("#me-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
