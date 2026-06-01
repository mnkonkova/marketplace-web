# E2E (Cypress)

E2E-тесты фронта против реального бека `marketplace-api`.

## Запуск

```bash
# 1. Поднять бек (один раз)
cd ~/marketplace-api
make up && make migrate-up && make seed

# 2. Поднять фронт
cd ~/marketplace-web/web
npm start              # http://localhost:4200

# 3. В соседнем терминале — тесты
npm run cy:open        # интерактивный режим
npm run cy:run         # headless для CI
```

### ENV-переменные

| Переменная | Дефолт | Зачем |
|---|---|---|
| `CYPRESS_BASE_URL` | `http://localhost:4200` | фронт |
| `CYPRESS_API_BASE_URL` | `http://localhost:8080/api/v1` | бек, если поднят не локально (например, виртуалка `http://192.168.64.2:8080/api/v1`) |

## Архитектурные решения

**Реальный бек, не моки.** Тесты гоняются против live `marketplace-api` —
выловят CORS, JWT, OpenSearch-индексирование, rate-limit. Моки оставляем
только для error-сценариев (500/timeout), которых live-бек не воспроизводит.

**Регистрация — через API, не через UI.** В каждом тесте кликать диалог
nz-modal медленно и хрупко. Хелпер `cy.register()` дёргает `POST
/auth/register` и кладёт токены в `localStorage` (ключ `marketpclce.auth.v1`,
тот же, что использует `AuthSessionStore`). UI-флоу регистрации/логина
покрывается **отдельным** тестом — он проверяет именно UI.

**Уникальные email.** `cy.uniqueEmail()` → `cy-<ts>-<rand>@e2e.local`.
БД засоряется — это ОК для dev-стенда. Для CI: между прогонами `make
migrate-down × N && make migrate-up && make seed`, либо отдельная test-БД.

**Селекторы.** Приоритет:
1. `[data-testid="..."]` — там, где иначе никак (динамические списки,
   нестабильные тексты).
2. `role` / `aria-*` / `<label>` — для форм.
3. Текст (`cy.contains('button', /…/i)`) — короткие неизменные подписи
   (`Войти`, `Кабинет`).
4. CSS-классы ng-zorro (`.ant-modal-content`) — только когда других нет;
   при апгрейде ng-zorro могут поломаться.

**Чистка между тестами.** `beforeEach` чистит localStorage. БД НЕ
сбрасываем — иначе тесты не параллелятся. Уникальные email + отсутствие
shared-state между тестами это решают.

## Структура

```
cypress/
├── e2e/
│   ├── smoke/      — каждая страница открывается, без JS-ошибок
│   ├── auth/       — register, login, email verify, password reset
│   ├── discovery/  — поиск, фильтры, clarify  [TODO]
│   ├── profile/    — публичный профиль специалиста [TODO]
│   ├── cabinet/    — /me: редактирование, портфолио CRUD [TODO]
│   └── leads/      — project cart → lead creation [TODO]
├── support/
│   ├── commands.ts — cy.register, cy.login, cy.apiRequest, etc.
│   ├── e2e.ts      — global hooks (healthcheck, beforeEach)
│   └── index.d.ts  — типы кастомных команд
└── fixtures/       — статичные данные (если потребуются)
```

## Roadmap

| Итерация | Домен | Статус |
|---|---|---|
| 1 | Фундамент + smoke main + образец auth | ✅ |
| 2 | auth: verify-email, password-reset, kind=client/specialist/both | ⏳ |
| 3 | discovery: search текст/фильтры/clarify/broadened/relaxed | ⏳ |
| 4 | profile: открытие, контакты, портфолио, отзывы | ⏳ |
| 5 | cabinet: профиль, категории, навыки, портфолио CRUD | ⏳ |
| 6 | leads: project-cart → /leads, статусы | ⏳ |
