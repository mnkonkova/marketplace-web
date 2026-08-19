# marketplace-web

Фронт маркетплейса: Angular 19, Feature-Sliced Design, standalone-компоненты,
signals, `inject()`, `OnPush`, ng-zorro-antd. Тёмная тема. Код приложения —
в `web/`, в корне — `Caddyfile` и `Dockerfile` прод-образа.

## Структура

`web/src/{pages,widgets,features,entities,shared}` — слои FSD. Алиасы
`@pages/*`, `@widgets/*`, `@features/*`, `@entities/*`, `@shared/*` заданы
в `tsconfig.json`.

Тесты лежат в `web/test-specs/`, а НЕ рядом с кодом. Билдер karma ищет их
по `include` в `angular.json` (`../test-specs/**/*.spec.ts`) — путь
относительно `sourceRoot`, то есть `src`. Сломаешь `include` — karma
найдёт ноль спеков и напишет «Executed 0 of 0 SUCCESS», то есть зелёный
прогон, в котором не выполнилось ничего.

## Перед каждым пушем — прогон тестов локально

GitHub Actions на аккаунте заблокированы по биллингу, CI не проверяет
ничего. Пока это так, гоняем руками:

```bash
cd web
CHROME_BIN=/home/foxxmary/.cache/ms-playwright/chromium-1223/chrome-linux/chrome \
  npm run test:ci
npx ng build --configuration production
```

Именно `test:ci`, а не `npm test`: в нём лаунчер `ChromeHeadlessNoSandbox`,
без `--no-sandbox` хромиум на этих ядрах не стартует. Системного Chrome
нет, поэтому `CHROME_BIN` обязателен.

Прод-сборка должна проходить без ошибок и без Sass-предупреждений. Если
появились `mixed-decls` — значит в правиле есть декларации после
вложенного правила (частый случай: `@include` с медиа-запросом стоит
перед обычными свойствами; ставь инклуд последним).

## Локальный запуск

```bash
cd web && npx ng serve --host 0.0.0.0 --port 4200
```

Фронт ходит в API напрямую по `apiBaseUrl` из `src/environments/`
(dev: `http://192.168.64.2:8080/api/v1`), CORS разрешён в `.env` бэкенда.

## Чего не делать

Не форматировать репозиторий целиком «заодно»: ~110 файлов не по
prettier с прошлых спринтов, и такой коммит утопит ревью. Форматируй
только те файлы, которые правишь.
