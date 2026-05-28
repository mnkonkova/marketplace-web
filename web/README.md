# Marketplace Frontend (Angular 19)

[Feature-Sliced Design](https://feature-sliced.design/): `app/`, `pages/`, `widgets/`, `features/`, `entities/`, `shared/`.

Бэкенд — отдельный репозиторий **[marketplace-api](https://github.com/mnkonkova/marketplace-api)** (локально, например `C:\Users\David\Desktop\work-projects\marketplace-api`).

## Локальная разработка

Нужны **два терминала**: API из `marketplace-api` и Angular.

### 1. Инфраструктура и API (`marketplace-api`)

```bash
cd C:/Users/David/Desktop/work-projects/marketplace-api   # свой путь
cp .env.example .env
make up
make migrate-up
make seed          # опционально: демо-аккаунты
make run           # API на :8080
```

В **другом** терминале (иначе лента/поиск пустые):

```bash
cd C:/Users/David/Desktop/work-projects/marketplace-api
make run-worker    # индексация OpenSearch (specialists + feed_videos)
```

Проверка:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/api/v1/categories
```

Swagger: http://localhost:8080/swagger/index.html

В `.env` бэкенда для `ng serve` на :4200 должны быть CORS (уже в `.env.example`):

```env
CORS_ORIGINS=http://localhost:4200,http://127.0.0.1:4200
```

Если фронт без прокси (прямой URL в `environment`) — без CORS не заработает.

### 2. Angular (`frontend/` в этом репо)

```bash
cd frontend
npm install
npm start
```

UI: **http://localhost:4200**

В dev запросы идут **напрямую** на `http://localhost:8080/api/v1` (`environment.development.ts`, CORS в `marketplace-api/.env`). Прокси `proxy.conf.js` не обязателен.

Если API на другом порту — поменяйте `apiBaseUrl` в `src/environments/environment.development.ts`.

### Демо-логин (после `make seed`)

Пароль: **`seedseed123`**, например `anya.editor@example.com`.

## Сборка production

```bash
npm run build
```

Артефакт: `dist/frontend/browser/`. На проде фронт обычно за Caddy рядом с API (см. `marketplace-api` → `docs/DEPLOY.md`).

## Маршруты

| Путь                          | Экран              |
| ----------------------------- | ------------------ |
| `/`                           | Главная, категории |
| `/search?category=…` / `?q=…` | Лента / AI-подбор  |
| `/specialist/:id`             | Профиль            |
| `/me`                         | Кабинет (JWT)      |

## API

Базовый URL: `environment.apiBaseUrl` → `/api/v1` (через прокси в dev).

Ручки: auth, catalog, search, feed, specialists, leads, reviews, `/me/*` — см. README и Swagger в `marketplace-api`.
