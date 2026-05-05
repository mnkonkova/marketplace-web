/* ──────────────────────────────────────────────────────────────────
   pages/feed — TikTok-стиль вертикальная лента видео.

   Архитектура:
   - Контейнер #feed-list — snap-y mandatory, каждый .feed-item = 100% high.
   - IntersectionObserver (root = #feed-list, threshold = 0.75) играет/паузит
     только видимое видео. Один видим — один играет.
   - Mute по умолчанию (autoplay-with-sound браузеры блокируют до user gesture).
     После первого тапа по mute-кнопке — звук на сессию (state.feedView.muted).
   - Прелоад: ±1 от текущего → preload="auto"; остальное — preload="none".
   - Курсор-пагинация: подгружаем следующую страницу когда виден предпоследний
     элемент.
   ────────────────────────────────────────────────────────────────── */

import { API, state } from "../shared/state.js";
import { $, $$, escape, formatRate, categoryTitle } from "../shared/ui.js";
import { showView, syncURL, buildSearchQs, gotoSpecialist } from "../shared/router.js";
import { inCart, toggleCart } from "../shared/cart.js";

const VIEW_KEY = "marketpclce.results_view.v1";
const MUTED_KEY = "marketpclce.feed_muted.v1";

// state.feedView держит in-memory срез ленты, чтобы при back→forward можно было
// восстановиться без перезагрузки. Сохраняем в state, а не в файловой переменной,
// чтобы router/show_view логика была согласованной.
function ensureFeedState() {
  if (!state.feedView) {
    state.feedView = {
      params: null,
      items: [],
      cursor: "",
      loading: false,
      done: false,
      muted: localStorage.getItem(MUTED_KEY) !== "off",
      observer: null,
      activeEl: null,
    };
  }
  return state.feedView;
}

export function preferFeedView() {
  return (localStorage.getItem(VIEW_KEY) || "feed") === "feed";
}

export function setPreferredView(view) {
  localStorage.setItem(VIEW_KEY, view);
}

/* ───── public entry ─────────────────────────────────────────── */

export async function showFeed(params, opts = {}) {
  const { pushURL = false } = opts;
  if (pushURL) syncURL("/search" + buildSearchQs(params));
  const f = ensureFeedState();
  f.params = params || {};
  f.items = [];
  f.cursor = "";
  f.loading = false;
  f.done = false;

  showView("feed");
  document.body.classList.add("feed-active");

  const titleEl = $("#feed-title");
  const cats = (params && params.categories) || [];
  if (cats.length === 1) {
    const cat = state.categories.find(c => c.code === cats[0]);
    titleEl.textContent = cat ? cat.title : "Лента";
  } else if (params && params.q) {
    titleEl.textContent = "Подбор по запросу";
  } else {
    titleEl.textContent = "Все специалисты";
  }

  const list = $("#feed-list");
  list.innerHTML = "";
  $("#feed-empty").classList.add("hidden");

  await loadNextPage();
  startPlayback();
}

export function hideFeed() {
  document.body.classList.remove("feed-active");
  pauseAllVideos();
  const f = state.feedView;
  if (f && f.observer) {
    f.observer.disconnect();
    f.observer = null;
  }
}

/* ───── data loading ─────────────────────────────────────────── */

async function loadNextPage() {
  const f = state.feedView;
  if (!f || f.loading || f.done) return;
  f.loading = true;
  $("#feed-loading").classList.remove("hidden");

  try {
    const qs = new URLSearchParams();
    const p = f.params || {};
    if (p.q) qs.set("q", p.q);
    (p.categories || []).forEach(c => qs.append("category", c));
    (p.skills || []).forEach(s => qs.append("skill", s));
    if (p.city) qs.set("city", p.city);
    if (f.cursor) qs.set("cursor", f.cursor);

    const res = await fetch(`${API}/feed?${qs.toString()}`);
    if (!res.ok) throw new Error("feed_failed");
    const data = await res.json();
    const items = data.items || [];

    if (!items.length && f.items.length === 0) {
      $("#feed-empty").classList.remove("hidden");
      f.done = true;
      return;
    }

    appendItems(items);
    f.cursor = data.next_cursor || "";
    if (!f.cursor) f.done = true;
  } catch (_) {
    // молчаливо: лента не критична, юзер может переключиться в список
    if (f.items.length === 0) {
      $("#feed-empty").classList.remove("hidden");
    }
    f.done = true;
  } finally {
    f.loading = false;
    $("#feed-loading").classList.add("hidden");
  }
}

function appendItems(items) {
  const f = state.feedView;
  const list = $("#feed-list");
  for (const it of items) {
    f.items.push(it);
    list.appendChild(feedItemEl(it, f.items.length - 1));
  }
}

/* ───── item element ─────────────────────────────────────────── */

function feedItemEl(it, index) {
  const f = state.feedView;
  const article = document.createElement("article");
  article.className = "feed-item";
  article.dataset.index = String(index);
  article.dataset.specId = it.specialist.user_id;

  const sp = it.specialist;
  const v = it.video;

  const rate = formatRate(sp.rate_min, sp.rate_max, sp.currency);
  const ratingMeta = sp.reviews_count
    ? `★ ${(sp.rating_avg || 0).toFixed(1)} · ${sp.reviews_count} отз.`
    : "новый";
  const cityLine = `${escape(sp.city || "удалённо")} · ${escape(ratingMeta)}`;
  const primary = sp.primary_category || (sp.categories && sp.categories[0]);
  const catChip = primary
    ? `<span class="feed-cat-chip">${escape(categoryTitle(primary))}</span>`
    : "";

  // Видео: muted=true до user gesture, поэтому autoplay стартует. После первого
  // тапа по 🔊 в шапке state.feedView.muted=false, и play() уже идёт со звуком.
  article.innerHTML = `
    <video class="feed-video"
           src="${escape(v.url)}"
           ${v.thumb ? `poster="${escape(v.thumb)}"` : ""}
           playsinline loop preload="none"
           ${f.muted ? "muted" : ""}></video>
    <div class="feed-overlay">
      <div class="feed-overlay-left">
        <div class="feed-spec-name">${escape(sp.display_name)}</div>
        <div class="feed-spec-meta">${cityLine} · <span class="feed-spec-rate">${escape(rate)}</span></div>
        <div class="feed-spec-bio">${escape(sp.bio || "")}</div>
        <div class="feed-spec-cats">${catChip}</div>
      </div>
      <div class="feed-overlay-right">
        <div class="feed-action-stack">
          <button class="feed-action feed-cart" type="button" aria-label="В проект"
                  data-cart-toggle="${escape(sp.user_id)}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <span class="feed-action-label">в проект</span>
        </div>
        <div class="feed-action-stack">
          <button class="feed-action feed-profile" type="button" aria-label="Профиль">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
          <span class="feed-action-label">профиль</span>
        </div>
        <div class="feed-video-idx">${it.video_idx + 1}/${it.video_total}</div>
      </div>
    </div>
  `;

  // Cart-кнопка: цвет/состояние из state, тогл по клику.
  const cartBtn = article.querySelector(".feed-cart");
  cartBtn.classList.toggle("is-on", inCart(sp.user_id));
  cartBtn.addEventListener("click", e => {
    e.stopPropagation();
    toggleCart({
      user_id: sp.user_id,
      display_name: sp.display_name,
      city: sp.city,
      rate_min: sp.rate_min,
      rate_max: sp.rate_max,
      currency: sp.currency,
      categories: sp.categories,
    }, cartBtn);
  });

  // Профиль — переход на /specialist/:id, лента остаётся в истории.
  article.querySelector(".feed-profile").addEventListener("click", e => {
    e.stopPropagation();
    gotoSpecialist({
      user_id: sp.user_id,
      display_name: sp.display_name,
      city: sp.city,
      rate_min: sp.rate_min,
      rate_max: sp.rate_max,
      currency: sp.currency,
      categories: sp.categories,
      bio: sp.bio,
      avatar_url: sp.avatar_url,
      rating_avg: sp.rating_avg,
      reviews_count: sp.reviews_count,
    });
  });

  // Тап по самому видео — toggle pause/play.
  const video = article.querySelector(".feed-video");
  video.addEventListener("click", () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  // Если видео не загрузилось — оставляем постер.
  video.addEventListener("error", () => {
    video.style.display = "none";
    const fb = document.createElement("div");
    fb.className = "feed-poster-fallback";
    fb.textContent = "Видео недоступно";
    article.insertBefore(fb, article.firstChild);
  });

  return article;
}

/* ───── playback (IntersectionObserver) ───────────────────────── */

function startPlayback() {
  const f = state.feedView;
  if (f.observer) f.observer.disconnect();

  const list = $("#feed-list");
  f.observer = new IntersectionObserver(handleIntersections, {
    root: list,
    threshold: [0, 0.5, 0.75, 1],
  });
  $$(".feed-item", list).forEach(el => f.observer.observe(el));

  // Первый айтем — стартуем сразу (IntersectionObserver сработает асинхронно,
  // но в момент входа в feed-view scrollTop=0 → первый и так visible).
  const first = list.firstElementChild;
  if (first) activate(first);
}

function handleIntersections(entries) {
  const f = state.feedView;
  // выбираем самый «видимый»
  let best = null;
  let bestRatio = 0;
  for (const e of entries) {
    if (e.intersectionRatio > bestRatio) {
      best = e.target;
      bestRatio = e.intersectionRatio;
    }
  }
  if (!best || bestRatio < 0.5) return;
  if (best === f.activeEl) return;
  activate(best);

  // подгружаем следующую страницу при подходе к концу
  const idx = parseInt(best.dataset.index, 10);
  if (!isNaN(idx) && f.items.length - idx <= 2) {
    loadNextPage();
  }
}

function activate(el) {
  const f = state.feedView;
  if (f.activeEl === el) return;

  // паузим прошлое
  if (f.activeEl) {
    const prev = f.activeEl.querySelector(".feed-video");
    if (prev) prev.pause();
  }
  f.activeEl = el;

  // обновляем preload у соседей: текущий + ±1 = "auto", остальное = "none"
  const list = $("#feed-list");
  const items = $$(".feed-item", list);
  const i = items.indexOf(el);
  items.forEach((it, j) => {
    const v = it.querySelector(".feed-video");
    if (!v) return;
    if (Math.abs(j - i) <= 1) v.preload = "auto";
    else v.preload = "none";
  });

  // запускаем активное
  const video = el.querySelector(".feed-video");
  if (video) {
    video.muted = f.muted;
    video.play().catch(() => {
      // autoplay-with-sound заблокирован — пробуем muted-фолбек
      if (!f.muted) {
        video.muted = true;
        video.play().catch(() => {});
      }
    });
  }
}

function pauseAllVideos() {
  $$(".feed-item .feed-video").forEach(v => v.pause());
}

/* ───── mute toggle ──────────────────────────────────────────── */

export function bindFeedShell() {
  const muteBtn = $("#feed-mute");
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      const f = ensureFeedState();
      f.muted = !f.muted;
      localStorage.setItem(MUTED_KEY, f.muted ? "on" : "off");
      muteBtn.setAttribute("aria-pressed", String(!f.muted));
      muteBtn.querySelector(".feed-icon-mute").classList.toggle("hidden", !f.muted);
      muteBtn.querySelector(".feed-icon-sound").classList.toggle("hidden", f.muted);
      // применяем ко всем видео и переигрываем активное
      $$(".feed-item .feed-video").forEach(v => { v.muted = f.muted; });
      if (f.activeEl) {
        const v = f.activeEl.querySelector(".feed-video");
        if (v) v.play().catch(() => {});
      }
    });
    // начальное состояние иконки
    const f = ensureFeedState();
    muteBtn.setAttribute("aria-pressed", String(!f.muted));
    muteBtn.querySelector(".feed-icon-mute").classList.toggle("hidden", !f.muted);
    muteBtn.querySelector(".feed-icon-sound").classList.toggle("hidden", f.muted);
  }

  const toggle = $("#feed-view-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      setPreferredView("list");
      // импортируем по требованию, чтобы не тащить results.js в граф feed.js
      import("./results.js").then(m => {
        const f = state.feedView;
        hideFeed();
        m.routeSearchAsList(f && f.params).catch(() => {});
      });
    });
  }

  // кнопка из feed-empty: переключиться в список
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-action='feed-to-list']");
    if (!t) return;
    setPreferredView("list");
    import("./results.js").then(m => {
      const f = state.feedView;
      hideFeed();
      m.routeSearchAsList(f && f.params).catch(() => {});
    });
  });
}

// Вспомогательное — для отладки в консоли
export function feedSpecCount() {
  const f = state.feedView;
  if (!f) return 0;
  const seen = new Set();
  f.items.forEach(it => seen.add(it.specialist.user_id));
  return seen.size;
}
