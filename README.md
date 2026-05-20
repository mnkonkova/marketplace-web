# marketplace-web

Фронт marketplace MVP — ванильная статика (ES-модули) + Tailwind CSS.
Бэкенд живёт в отдельном репо [`marketplace-api`](https://github.com/mnkonkova/marketplace-api).

## Структура

- `web/index.html` — корневая страница, подключает `app.js` и собранный `styles.css`.
- `web/app.js` — entry-точка: регистрирует роуты, биндит UI, делает первый dispatch.
- `web/shared/` — state, ui, router, auth, cart, categories, actions.
- `web/pages/` — `roadmap.js`, `clarify.js`, `results.js`, `profile.js`, `me.js`, `feed.js`.
- `web/src/tailwind.css` — вход для Tailwind; результат собирается в `web/styles.css`.

## Локальный запуск

1. Поднять API из `marketplace-api`: `make up && make migrate-up && make run` (слушает `:8080`).
2. Собрать стили: `npm ci && npm run build:css` (или `npm run watch:css` в watch-режиме).
3. Выбрать одно из двух:
   - **Same-origin через Caddy**: `docker compose up` — фронт на http://localhost:8081, `/api/*` проксируется на хостовый API (`host.docker.internal:8080`). В `index.html` оставь `__API_BASE__ = ""`.
   - **Прямой к API через CORS**: в `web/index.html` поставь `window.__API_BASE__ = "http://localhost:8080"`, в API поставь `CORS_ORIGINS=http://localhost:5173` (или какой у тебя dev-хост) и отдавай `web/` любым статик-сервером (`python3 -m http.server`, Vite preview, и т.п.).

## Конфигурация API base

`web/shared/state.js` читает `window.__API_BASE__`. Этот global ставится в `<head>` `index.html` — переопредели его под окружение:

```html
<script>window.__API_BASE__ = "https://api.example.com";</script>
```

Пусто = same-origin (`/api/v1`).

## Деплой

`Dockerfile` собирает Tailwind и упаковывает статику в `caddy:2-alpine`. На сервере нужны env:

- `DOMAIN` — публичный домен (Caddy сам выпишет Let's Encrypt).
- `API_UPSTREAM` — `host:port` или `https://api.example.com`, куда проксировать `/api/*` и `/swagger/*`.

Если API на отдельном домене и проксирование не нужно — выкинь `handle /api/*` из `Caddyfile`, а в `index.html` пропиши абсолютный `__API_BASE__`.
