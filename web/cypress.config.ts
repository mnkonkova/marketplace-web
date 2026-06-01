import { defineConfig } from 'cypress';

// Фронт поднимается локально через `ng serve` (порт 4200), бек — через
// `make up` в marketplace-api (порт 8080). Переопределяется ENV-переменными
// CYPRESS_BASE_URL / CYPRESS_API_BASE_URL — нужно на CI или при кастомной
// инсталляции (например, бек в виртуалке: http://192.168.64.2:8080/api/v1).
export default defineConfig({
  e2e: {
    baseUrl: process.env['CYPRESS_BASE_URL'] ?? 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    fixturesFolder: 'cypress/fixtures',
    video: false,
    screenshotOnRunFailure: true,
    // Часть страниц (cabinet, profile) делает несколько последовательных
    // запросов к беку при открытии — 10с дефолт мало на холодном API.
    defaultCommandTimeout: 15000,
    requestTimeout: 15000,
    env: {
      apiBaseUrl: process.env['CYPRESS_API_BASE_URL'] ?? 'http://localhost:8080/api/v1',
    },
  },
});
