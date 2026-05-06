/* ──────────────────────────────────────────────────────────────────
   shared/cart — «проект»: список выбранных специалистов, его диалог,
   вычисление суммарного бюджета и lead-форма.

   Корзина — залогиненные хранят в localStorage (между сессиями), гости —
   в sessionStorage (внутри вкладки). При логине/логауте cart мигрирует
   в нужное хранилище через saveCart() (вызывается auth.js).
   ────────────────────────────────────────────────────────────────── */

import { API, CART_KEY, state, isLoggedIn } from "./state.js";
import { $, escape, fmt, formatRate, specialistsWord } from "./ui.js";
import { gotoSpecialist } from "./router.js";

function cartStorage() {
  return isLoggedIn() ? localStorage : sessionStorage;
}

export function loadCart() {
  // приоритет — текущему хранилищу, fallback на «другое» (миграция со старых
  // версий, где всё лежало в localStorage).
  const primary = cartStorage();
  const secondary = primary === localStorage ? sessionStorage : localStorage;
  for (const store of [primary, secondary]) {
    try {
      const raw = store.getItem(CART_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return [];
}

export function saveCart() {
  const primary = cartStorage();
  const secondary = primary === localStorage ? sessionStorage : localStorage;
  try { primary.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (_) {}
  try { secondary.removeItem(CART_KEY); } catch (_) {}
}

export function inCart(userId) { return state.cart.some(s => s.user_id === userId); }

export function addToCart(spec) {
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

export function removeFromCart(userId) {
  state.cart = state.cart.filter(s => s.user_id !== userId);
  saveCart(); renderCartButton(); syncCartButtons(); renderCartItems();
}

export function clearCart() {
  state.cart = [];
  saveCart(); renderCartButton(); syncCartButtons(); renderCartItems();
}

export function toggleCart(spec, btn) {
  if (inCart(spec.user_id)) removeFromCart(spec.user_id);
  else addToCart(spec);
  if (btn) updateCartButton(btn, spec.user_id);
}

// Иконки для feed-варианта кнопки (круглый 48×48). Текст «В проект» в этой
// форме переполнял кнопку — поэтому для feed-cart рендерим только +/−.
const FEED_PLUS_SVG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const FEED_MINUS_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';

export function updateCartButton(btn, userId) {
  const inside = inCart(userId);
  if (btn.classList.contains("feed-cart")) {
    btn.innerHTML = inside ? FEED_MINUS_SVG : FEED_PLUS_SVG;
    btn.setAttribute("aria-label", inside ? "Убрать из проекта" : "В проект");
    // Подпись лежит соседом в .feed-action-stack — обновляем синхронно.
    const stack = btn.parentElement;
    const label = stack && stack.querySelector(".feed-action-label");
    if (label) label.textContent = inside ? "В проекте" : "В проект";
  } else {
    btn.textContent = inside ? "В проекте ✓" : "В проект";
  }
  btn.classList.toggle("in-cart", inside);
}

export function syncCartButtons() {
  document.querySelectorAll("[data-cart-toggle]").forEach(btn => {
    updateCartButton(btn, btn.getAttribute("data-cart-toggle"));
  });
}

/* ───── cart dialog ────────────────────────────────────────────── */

export function renderCartButton() {
  const btn = $("#cart-btn");
  if (!btn) return;
  const count = state.cart.length;
  $("#cart-count").textContent = String(count);
  btn.classList.toggle("is-empty", count === 0);
}

export function openCartDialog() {
  renderCartItems();
  $("#cart-dialog").showModal();
}

export function renderCartItems() {
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
      gotoSpecialist(s);
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

export function openLeadDialog() {
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

export function bindLeadDialog() {
  $("#lead-form").addEventListener("submit", e => {
    e.preventDefault();
    submitLead(e.target);
  });
}

export function bindCartDialog() {
  $("#cart-btn").addEventListener("click", openCartDialog);
}
