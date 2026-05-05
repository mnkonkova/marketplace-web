/* ──────────────────────────────────────────────────────────────────
   shared/auth — login/register/logout, JWT-сессия, authFetch с авто-
   рефрешем токена, диалог авторизации.
   ────────────────────────────────────────────────────────────────── */

import { API, AUTH_KEY, state, loadAuth, isLoggedIn } from "./state.js";
import { $, $$ } from "./ui.js";
import { navigate } from "./router.js";
import { saveCart } from "./cart.js";

export { loadAuth, isLoggedIn };

export function saveAuth(pair, kind) {
  const cur = loadAuth() || {};
  const next = {
    access_token: pair.access_token,
    refresh_token: pair.refresh_token,
    kind: kind || cur.kind || "",
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(next));
  // переносим корзину гостя в localStorage — теперь cart переживёт перезапуск.
  saveCart();
  syncAuthUI();
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  // обратный перенос: cart остаётся у текущего пользователя в этой сессии,
  // но из localStorage уходит, чтобы не светиться следующему гостю.
  saveCart();
  syncAuthUI();
}

export async function authFetch(url, opts = {}) {
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

export function syncAuthUI() {
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

/* ───── auth dialog ────────────────────────────────────────────── */

export function openAuthDialog(tab) {
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

export function bindAuthDialog() {
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
      if (probe.ok) navigate("/me");
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
      if (kind === "specialist" || kind === "both") navigate("/me");
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

export function logout() {
  clearAuth();
  state.me = null;
  navigate("/");
}
