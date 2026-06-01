import './commands';

// Fail fast: если бек/фронт не подняты, ловим это до того, как первый тест
// потратит таймауты на selector wait'ы. Выводим понятное сообщение.
before(() => {
  const apiBase = Cypress.env('apiBaseUrl') as string;
  cy.request({
    url: apiBase.replace(/\/api\/v1\/?$/, '') + '/healthz',
    failOnStatusCode: false,
    timeout: 5000,
  }).then((res) => {
    if (res.status !== 200) {
      throw new Error(
        `marketplace-api недоступен на ${apiBase}. Запусти: cd ~/marketplace-api && make up && make migrate-up && make seed.`,
      );
    }
  });
});

// Между тестами фронт может оставлять токены/корзину в localStorage;
// чистим, чтобы каждый тест стартовал с пустого стейта.
beforeEach(() => {
  cy.clearAuth();
});

// ng-zorro иногда кидает в консоль ResizeObserver warnings, которые Cypress
// по умолчанию НЕ роняет в тест. Если когда-то будем включать `chromeWebSecurity`
// или `experimentalFetchPolyfill` — этот блок поможет.
Cypress.on('uncaught:exception', (err) => {
  if (/ResizeObserver loop/.test(err.message)) {
    return false;
  }
  return undefined;
});
