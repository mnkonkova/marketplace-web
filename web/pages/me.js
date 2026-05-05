/* ──────────────────────────────────────────────────────────────────
   pages/me — кабинет специалиста (/me): редактирование профиля,
   категории, проверка имени/bio, публикация.
   ────────────────────────────────────────────────────────────────── */

import { API, state } from "../shared/state.js";
import { $, $$, escape } from "../shared/ui.js";
import { syncURL, showView } from "../shared/router.js";
import { isLoggedIn, authFetch, openAuthDialog } from "../shared/auth.js";
import { loadCategories } from "../shared/categories.js";

export async function routeMe() {
  if (!state.categories.length) {
    try { await loadCategories(); } catch (_) {}
  }
  await openMe();
}

async function openMe() {
  if (!isLoggedIn()) {
    // прямой заход на /me без авторизации — возвращаем URL на /
    // (auth-диалог поверх главной), чтобы адрес не «врал»
    if (location.pathname !== "/") syncURL("/", { replace: true });
    showView("roadmap");
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
    // Портфолио грузим после профиля — независимый блок, ошибка тут не блокирует
    // редактирование основного.
    loadMePortfolio().catch(() => {});
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

export function bindMeForm() {
  const form = $("#me-form");
  form.addEventListener("submit", e => {
    e.preventDefault();
    saveMeProfile({ publish: false });
  });
  $("#me-check-bio").addEventListener("click", runProfileCheck);
  bindPortfolioForm();
}

/* ───── portfolio (видео) ───────────────────────────────────────
   Сейчас — только URL-добавление. Полноценный аплоад с устройства
   подключим, когда появятся ключи Yandex Object Storage; форма
   будет та же, добавится «или загрузите файл». */

function bindPortfolioForm() {
  const btn = $("#me-pf-add");
  if (!btn) return;
  btn.addEventListener("click", addPortfolioVideo);
  // Список с delete-кнопками — делегатор, чтобы не перенавешивать при rerender.
  const list = $("#me-portfolio-list");
  if (list) {
    list.addEventListener("click", e => {
      const t = e.target.closest("[data-pf-delete]");
      if (t) deletePortfolioVideo(t.dataset.pfDelete);
    });
  }
}

async function loadMePortfolio() {
  try {
    const res = await authFetch(`${API}/me/portfolio`);
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = await res.json();
    renderMePortfolio(data.items || []);
  } catch (err) {
    setPortfolioMsg(`Не удалось загрузить портфолио: ${err.message}`, true);
  }
}

function renderMePortfolio(items) {
  const list = $("#me-portfolio-list");
  const cnt = $("#me-portfolio-count");
  if (!list) return;
  list.innerHTML = "";
  const videos = items.filter(it => it.video_url);
  cnt.textContent = videos.length ? `${videos.length} видео` : "пока пусто";
  if (videos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "text-xs text-white/40 italic";
    empty.textContent = "Добавьте первый ролик — он появится в ленте, когда профиль опубликован.";
    list.appendChild(empty);
    return;
  }
  videos.forEach(it => list.appendChild(portfolioRow(it)));
}

function portfolioRow(it) {
  const row = document.createElement("div");
  row.className = "me-pf-row";
  const thumb = it.thumbnail_url
    ? `<img class="me-pf-thumb" src="${escape(it.thumbnail_url)}" alt="" loading="lazy" />`
    : `<div class="me-pf-thumb me-pf-thumb-empty">▶</div>`;
  row.innerHTML = `
    ${thumb}
    <div class="me-pf-main">
      <div class="me-pf-title">${escape(it.title || "(без названия)")}</div>
      <div class="me-pf-meta"><a href="${escape(it.video_url)}" target="_blank" rel="noopener">открыть mp4 ↗</a>${it.duration_sec ? ` · ${it.duration_sec}s` : ""}${it.aspect ? ` · ${escape(it.aspect)}` : ""}</div>
      ${it.description ? `<div class="me-pf-desc">${escape(it.description)}</div>` : ""}
    </div>
    <button type="button" class="me-pf-delete" data-pf-delete="${escape(it.id)}" aria-label="Удалить">✕</button>
  `;
  return row;
}

async function addPortfolioVideo() {
  const videoURL = $("#me-pf-video-url").value.trim();
  const thumbURL = $("#me-pf-thumb-url").value.trim();
  const title = $("#me-pf-title").value.trim();
  const description = $("#me-pf-description").value.trim();
  if (!videoURL) {
    setPortfolioMsg("Введите URL видео.", true);
    return;
  }
  if (!title) {
    setPortfolioMsg("Введите заголовок.", true);
    return;
  }
  const btn = $("#me-pf-add");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Добавляем…";
  try {
    const res = await authFetch(`${API}/me/portfolio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        video_url: videoURL,
        thumbnail_url: thumbURL,
        title,
        description,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `http_${res.status}`);
    }
    $("#me-pf-video-url").value = "";
    $("#me-pf-thumb-url").value = "";
    $("#me-pf-title").value = "";
    $("#me-pf-description").value = "";
    setPortfolioMsg("Добавлено.", false);
    await loadMePortfolio();
  } catch (err) {
    setPortfolioMsg(`Не удалось добавить: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function deletePortfolioVideo(id) {
  if (!confirm("Удалить это видео?")) return;
  try {
    const res = await authFetch(`${API}/me/portfolio/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.status !== 204 && !res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `http_${res.status}`);
    }
    setPortfolioMsg("Удалено.", false);
    await loadMePortfolio();
  } catch (err) {
    setPortfolioMsg(`Не удалось удалить: ${err.message}`, true);
  }
}

function setPortfolioMsg(text, isError) {
  const el = $("#me-portfolio-msg");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("text-danger", !!isError);
  el.classList.toggle("text-mint-400", !isError && !!text);
  if (text) {
    setTimeout(() => {
      if (el.textContent === text) el.textContent = "";
    }, 4000);
  }
}

export async function saveMeProfile({ publish }) {
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

  if (publish) {
    if (meSelection.codes.size === 0) {
      showMeError("Выберите хотя бы одну категорию перед публикацией.");
      return;
    }
    if (!patch.bio.trim()) {
      showMeError("Заполните описание (bio) перед публикацией.");
      return;
    }
    const precheck = await precheckProfile(patch.bio, patch.display_name);
    if (precheck === "rejected") return;
    if (precheck === "error") return;
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
      res = await authFetch(`${API}/me/profile/publish`, { method: "POST" });
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "profile_rejected" && body.check) {
          renderProfileCheck(body.check, /*rejected*/ true);
          showMeError("Мы не пропустили профиль при публикации — поправьте и попробуйте снова.");
          state.me = profile;
          renderMeForm(profile);
          return;
        }
        if (body.error === "publish_incomplete") {
          showMeError("Заполните имя/название и описание (bio) перед публикацией.");
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

export async function unpublishMe() {
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

// precheckProfile — гоняет модерацию по bio и имени ДО PATCH, чтобы
// отвергнутый контент не успевал записаться в БД. Возвращает:
// "ok" | "rejected" | "error" | "skipped". "skipped" — LLM выключен.
async function precheckProfile(bio, displayName) {
  const publishBtn = document.querySelector('[data-action="me-publish"]');
  const origLabel = publishBtn ? publishBtn.textContent : null;
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.textContent = "Проверяем профиль…";
  }
  try {
    const res = await authFetch(`${API}/me/profile/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio, display_name: displayName }),
    });
    if (res.status === 503) return "skipped";
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showMeError(`Проверка профиля не удалась: ${err.error || `http_${res.status}`}. Изменения не сохранены.`);
      return "error";
    }
    const result = await res.json();
    if (!result.ok) {
      renderProfileCheck(result, /*rejected*/ true);
      showMeError("Мы не пропустили профиль — поправьте и попробуйте снова. Изменения не сохранены.");
      return "rejected";
    }
    return "ok";
  } catch (err) {
    showMeError(`Проверка профиля не удалась: ${err.message}. Изменения не сохранены.`);
    return "error";
  } finally {
    if (publishBtn && origLabel != null) {
      publishBtn.disabled = false;
      publishBtn.textContent = origLabel;
    }
  }
}

async function runProfileCheck() {
  const form = $("#me-form");
  const bio = form.elements.bio.value || "";
  const displayName = (form.elements.display_name.value || "").trim();
  if (!bio.trim() && !displayName) {
    showMeError("Заполните имя/название или описание перед проверкой.");
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
      body: JSON.stringify({ bio, display_name: displayName }),
    });
    if (res.status === 503) {
      showMeError("Проверка временно недоступна (нет ключа провайдера).");
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `http_${res.status}`);
    }
    const result = await res.json();
    renderProfileCheck(result, !result.ok);
  } catch (err) {
    showMeError(`Проверка не удалась: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function renderProfileCheck(result, rejected) {
  const el = $("#me-bio-check");
  el.classList.remove("hidden");
  el.innerHTML = `
    ${renderCheckPart("Имя/название", result.name)}
    ${renderCheckPart("Описание (bio)", result.bio)}
  `;
}

function renderCheckPart(label, part) {
  if (!part) return "";
  const ok = !!part.ok;
  const score = Number.isFinite(part.score) ? part.score : 0;
  const head = ok
    ? `✓ ${escape(label)} проходит проверку · ${score}/100`
    : `✗ ${escape(label)} нужно доработать · ${score}/100`;
  return `
    <div class="bio-check ${ok ? "ok" : "rejected"} border border-white/10 p-3 flex flex-col gap-2">
      <div class="bio-check-head">${head}</div>
      ${(part.reasons && part.reasons.length)
        ? `<ul class="bio-check-reasons">${part.reasons.map(r => `<li>${escape(r)}</li>`).join("")}</ul>`
        : ""}
      ${part.suggestion ? `<div class="bio-check-suggestion">Совет: ${escape(part.suggestion)}</div>` : ""}
    </div>
  `;
}

function showMeError(msg) {
  const el = $("#me-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
