/* ──────────────────────────────────────────────────────────────────
   shared/state — конфиг, общие константы, in-memory store.
   ────────────────────────────────────────────────────────────────── */

export const API = "/api/v1";

// Ключи storage объявлены здесь, потому что и cart.js, и auth.js используют
// одни и те же значения для миграции между sessionStorage/localStorage.
export const CART_KEY = "marketpclce.cart.v1";
export const AUTH_KEY = "marketpclce.auth.v1";

export const state = {
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
  cart: [],
};

export const ICONS = {
  editor: "🎬", video_director: "🎞️", motion: "✨", scriptwriter: "✍️",
  smm: "📱", ugc: "📸", blogger: "🌟", ads_seo: "🎯", seeding: "🌱",
};

// Группировка категорий на главной. Разделяет «кто делает контент» и «кто его
// доставляет аудитории». Категории, чей код не попал ни в одну группу, всё
// равно отрендерятся отдельной сеткой — чтобы новые коды в БД не пропадали
// до правки фронта.
export const CATEGORY_GROUPS = [
  {
    id: "production",
    title: "Производство",
    kicker: "контент-команды",
    codes: ["editor", "video_director", "motion", "scriptwriter", "ugc"],
  },
  {
    id: "promotion",
    title: "Продвижение",
    kicker: "медиа и реклама",
    codes: ["smm", "blogger", "ads_seo", "seeding"],
  },
];

// короткие тайтлы для компактных плиток bento (полное название всё равно
// видно в aria-label, в описании, в clarify и в результатах)
export const SHORT_TITLES = {
  video_director: "Видеорежиссёр",
};

export function tileTitle(cat) {
  return SHORT_TITLES[cat.code] || cat.title;
}

/* ───── auth read-only helpers ─────────────────────────────────────
   isLoggedIn() и loadAuth() живут в state.js (а не в auth.js), чтобы
   cart.js мог решать, в какое хранилище класть корзину, не импортируя
   auth.js — это разрывает цикл cart ↔ auth.
   ────────────────────────────────────────────────────────────────── */
export function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.access_token || !p.refresh_token) return null;
    return p;
  } catch (_) { return null; }
}

export function isLoggedIn() { return !!loadAuth(); }
