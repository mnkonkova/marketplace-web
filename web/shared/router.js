/* ──────────────────────────────────────────────────────────────────
   shared/router — History API, dispatch, view-switch.
   Четыре «настоящих» URL: /, /search, /specialist/:id, /me.
   clarify — режим главной (не свой URL): транзиентный шаг, refresh
   должен возвращать на /, а не возрождать пустой чат.

   navigate()  — поменять URL и отрисовать (push history).
   syncURL()   — поменять URL без re-render (когда уже отрисовали сами).
   popstate    — back/forward всегда заново гоняет route-handler.
                 Direct-load и in-flow обрабатываются одной дорожкой.

   Регистрация маршрутов вынесена наружу (registerRoutes), чтобы
   router.js не импортировал pages/* — это разрывает цикл.
   ────────────────────────────────────────────────────────────────── */

import { $ } from "./ui.js";

const routes = [];

export function registerRoutes(list) {
  routes.length = 0;
  for (const r of list) routes.push(r);
}

export function showView(name) {
  const feedEl = $("#view-feed");
  const wasFeed = feedEl && !feedEl.classList.contains("hidden");
  ["roadmap", "clarify", "feed", "results", "profile", "me"].forEach(v => {
    $(`#view-${v}`).classList.toggle("hidden", v !== name);
  });
  // body.feed-active гасит шапку и скролл — снимаем при выходе из feed,
  // и одновременно паузим видео, чтобы звук не уходил «в фон».
  if (name !== "feed") {
    document.body.classList.remove("feed-active");
    if (wasFeed) {
      document.querySelectorAll("#view-feed .feed-video").forEach(v => v.pause());
    }
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function buildSearchQs(params) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  (params.categories || []).forEach(c => qs.append("category", c));
  (params.skills || []).forEach(s => qs.append("skill", s));
  if (params.city) qs.set("city", params.city);
  const s = qs.toString();
  return s ? "?" + s : "";
}

export function syncURL(path, { replace = false, state: extra = null } = {}) {
  const url = new URL(path, location.origin);
  const st = extra || history.state || {};
  if (replace) history.replaceState(st, "", url);
  else         history.pushState(st, "", url);
}

export function navigate(path, opts = {}) {
  const url = new URL(path, location.origin);
  syncURL(path, opts);
  return dispatch(url);
}

export function dispatch(url) {
  const { pathname, searchParams } = url;
  for (const { re, h } of routes) {
    const m = pathname.match(re);
    if (m) return h(m.slice(1), searchParams);
  }
  // неизвестный URL — на главную
  syncURL("/", { replace: true });
  const home = routes.find(r => r.re.source === /^\/$/.source);
  if (home) return home.h([], new URLSearchParams());
}

// gotoSpecialist — общий хелпер открытия публичного профиля. Прокидывает
// lite-snapshot в history.state, чтобы routeSpec мог дать оптимистичный
// рендер до сетевого ответа. Живёт в router.js (а не в profile.js), чтобы
// cart.js и results.js могли его звать без импорта pages/profile.js.
export function gotoSpecialist(spec) {
  const url = new URL(`/specialist/${spec.user_id}`, location.origin);
  history.pushState({ lite: spec }, "", url);
  return dispatch(url);
}

export function initRouter() {
  window.addEventListener("popstate", () => {
    dispatch(new URL(location.href));
  });
}
