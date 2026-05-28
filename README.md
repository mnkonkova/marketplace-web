# marketplace-web

Фронт marketplace MVP — Angular 17+ (standalone-компоненты, signals).
Бэкенд живёт в отдельном репо [`marketplace-api`](https://github.com/mnkonkova/marketplace-api).

## Структура

- `web/` — Angular-проект (`angular.json`, `package.json`, `src/`).
  - `src/app/` — корневой компонент, `app.routes.ts`, `app.config.ts`.
  - `src/pages/` — страницы (main, clarify, feed, cabinet, specialist-profile, …).
  - `src/widgets/` — переиспользуемые UI-блоки (app-header, feed-view, portfolio-grid, …).
  - `src/features/` — фичи с собственным state (project-cart, auth).
  - `src/entities/` — API-клиенты и типы (auth, category, feed, me, specialist).
  - `src/shared/` — общая инфраструктура (`api/`, `lib/`).
  - `src/environments/` — `environment.ts`, `environment.development.ts`, `environment.prod.ts`.
- `Dockerfile` — two-stage сборка: Angular → Caddy со статикой.
- `Caddyfile` — TLS + SPA-fallback + reverse-proxy `/api/*`, `/swagger/*` на backend.

## Локальный запуск

1. Поднять API из `marketplace-api`: `./scripts/local_run.sh` (postgres/opensearch/redis в docker + API на `:8080` + worker).
2. Поставить зависимости фронта и запустить dev-server:
   ```bash
   cd web
   npm ci
   npm start          # ng serve, открыт на http://localhost:4200
   ```
3. Прокси `/api/*` настроен в `proxy.conf.js` — `ng serve` сам форвардит на хостовый API.

## Конфигурация API base

Файлы `web/src/environments/`:
- `environment.ts` — дефолт (`apiBaseUrl: '/api/v1'`, same-origin).
- `environment.development.ts` — dev (`/api/v1` через proxy.conf.js).
- `environment.prod.ts` — прод (`/api/v1`, same-origin через Caddy).

Angular CLI подменяет `environment.ts` на `environment.prod.ts` при `ng build`
(см. `fileReplacements` в `angular.json`).

Если фронт нужно положить на отдельном домене от API — поменяй `apiBaseUrl`
на абсолютный URL (`https://api.example.com/api/v1`) и в API выстави
`CORS_ORIGINS` со своим доменом фронта.

## Деплой

`Dockerfile` — two-stage: `node:20-alpine` собирает `web/` через `ng build`
(результат в `web/dist/frontend/browser/`), `caddy:2-alpine` отдаёт статику
с SPA-fallback и проксирует `/api/*` на backend.

В рантайме нужны env (берутся из `docker-compose.prod.yml` в `marketplace-api`):

- `DOMAIN` — публичный домен (Caddy сам выпишет Let's Encrypt по HTTP-01).
- `API_UPSTREAM` — `host:port` бэкенда (для деплоя одним стеком — `api:8080`).

Деплой запускается из `marketplace-api`:
```bash
make redeploy-web    # только фронт: git pull web → docker build → recreate
make redeploy        # всё: api + worker + web
```

Подробности — в README `marketplace-api`.
