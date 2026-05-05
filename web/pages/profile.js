/* ──────────────────────────────────────────────────────────────────
   pages/profile — публичный профиль специалиста (/specialist/:id).
   ────────────────────────────────────────────────────────────────── */

import { API } from "../shared/state.js";
import { $, escape, categoryTitle, formatRate } from "../shared/ui.js";
import { showView } from "../shared/router.js";
import { inCart, toggleCart } from "../shared/cart.js";

export async function routeSpec([id]) {
  showView("profile");
  const root = $("#profile-content");
  // history.state может содержать lite-snapshot карточки — даём
  // оптимистичный рендер до сетевого ответа.
  const lite = (history.state && history.state.lite) || null;
  root.innerHTML = lite
    ? renderProfile(lite, null)
    : `<div class="empty">Загружаем профиль…</div>`;
  if (lite) bindProfileActions(lite);
  try {
    const res = await fetch(`${API}/specialists/${id}`);
    if (!res.ok) throw new Error("not_found");
    const full = await res.json();
    root.innerHTML = renderProfile({ ...(lite || {}), ...full }, full);
    bindProfileActions(full);
  } catch (_) {
    if (!lite) root.innerHTML = `<div class="empty">Профиль не найден.</div>`;
  }
}

export function renderProfile(spec, full) {
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
