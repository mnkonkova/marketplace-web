/* ──────────────────────────────────────────────────────────────────
   shared/actions — глобальный делегатор data-action кнопок.
   Один body-listener вместо россыпи addEventListener'ов.
   ────────────────────────────────────────────────────────────────── */

import { state } from "./state.js";
import { $ } from "./ui.js";
import { navigate, showView, gotoSpecialist } from "./router.js";
import { clearCart, openLeadDialog } from "./cart.js";
import { openAuthDialog, logout } from "./auth.js";
import { restoreAiPicks } from "../pages/results.js";
import { saveMeProfile, unpublishMe } from "../pages/me.js";

export function bindGlobalActions() {
  document.body.addEventListener("click", e => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    switch (t.dataset.action) {
      case "back-roadmap": navigate("/"); break;
      // clarify — режим главной, отдельного URL нет, просто показываем view
      case "back-clarify": showView("clarify"); break;
      // back из профиля — отдаём решение браузеру (вернёт на /search или
      // куда угодно, откуда пришли)
      case "back-results": history.back(); break;
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
      case "open-me":      navigate("/me"); break;
      case "logout":       logout(); break;
      case "me-publish":   saveMeProfile({ publish: true }); break;
      case "me-unpublish": unpublishMe(); break;
      case "me-view-public":
        if (state.me && state.me.user_id) gotoSpecialist({ user_id: state.me.user_id, display_name: state.me.display_name });
        break;
    }
  });
}
