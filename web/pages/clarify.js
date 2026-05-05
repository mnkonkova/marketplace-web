/* ──────────────────────────────────────────────────────────────────
   pages/clarify — чат уточнения задачи перед поиском.
   Транзиентный режим (без своего URL): refresh возвращает на главную.
   ────────────────────────────────────────────────────────────────── */

import { API, state } from "../shared/state.js";
import { $ } from "../shared/ui.js";
import { showView } from "../shared/router.js";
import { runSearch } from "./results.js";

export function openClarify(category, opts = {}) {
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
        appendMsg("assistant", "Уточнение временно недоступно — переходим к поиску по вашему запросу.");
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

export function bindClarify() {
  $("#chat-form").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("#chat-input").value.trim();
    if (text) sendChat(text);
  });
  $("#run-search").addEventListener("click", () => runSearch());
}
