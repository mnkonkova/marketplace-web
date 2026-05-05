/* ──────────────────────────────────────────────────────────────────
   marketpclce — entry-модуль фронта. Импортирует страницы и shared-
   инфраструктуру, регистрирует маршруты, делает первичный dispatch.

   Резка по файлам:
     shared/  — state, ui, router, auth, cart, categories, actions
     pages/   — roadmap, clarify, results, profile, me
   ────────────────────────────────────────────────────────────────── */

import { state } from "./shared/state.js";
import { $ } from "./shared/ui.js";
import { initRouter, dispatch, registerRoutes } from "./shared/router.js";
import { syncAuthUI, bindAuthDialog } from "./shared/auth.js";
import {
  loadCart, renderCartButton, bindCartDialog, bindLeadDialog,
} from "./shared/cart.js";
import { loadCategories } from "./shared/categories.js";
import { bindGlobalActions } from "./shared/actions.js";

import { routeHome, renderRoadmap, bindHero } from "./pages/roadmap.js";
import { bindClarify } from "./pages/clarify.js";
import { routeSearch, bindResultsViewToggle } from "./pages/results.js";
import { bindFeedShell } from "./pages/feed.js";
import { routeSpec } from "./pages/profile.js";
import { routeMe, bindMeForm } from "./pages/me.js";

document.addEventListener("DOMContentLoaded", () => {
  // Корзина — читаем из storage до первого рендера, чтобы счётчик не моргал.
  state.cart = loadCart();
  renderCartButton();

  registerRoutes([
    { re: /^\/$/,                     h: routeHome   },
    { re: /^\/search$/,               h: routeSearch },
    { re: /^\/specialist\/([^\/]+)$/, h: routeSpec   },
    { re: /^\/me$/,                   h: routeMe     },
  ]);
  initRouter();

  bindHero();
  bindClarify();
  bindCartDialog();
  bindLeadDialog();
  bindAuthDialog();
  bindMeForm();
  bindFeedShell();
  bindResultsViewToggle();
  bindGlobalActions();
  syncAuthUI();

  // Главная: категории грузятся параллельно с первым dispatch — пустую
  // сетку покажем мгновенно, заполнится после ответа /api/v1/categories.
  loadCategories()
    .then(renderRoadmap)
    .catch(e => {
      $("#roadmap").innerHTML =
        `<div class="empty col-span-full">Не удалось загрузить категории: ${e.message}</div>`;
    });

  // первый рендер — через роутер, чтобы прямой заход на /search или
  // /specialist/:id отрабатывал точно так же, как in-flow навигация.
  dispatch(new URL(location.href));
});
