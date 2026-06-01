/// <reference types="cypress" />

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface RegisteredUser {
  email: string;
  password: string;
  user_id: string;
  tokens: TokenPair;
  kind: 'client' | 'specialist' | 'both';
  display_name: string;
}

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Уникальный email — чтобы тесты не конфликтовали друг с другом и
       * с предыдущими запусками. Формат `cy-<ts>-<rand>@e2e.local`,
       * `@e2e.local` явно не-резолвящийся домен.
       */
      uniqueEmail(prefix?: string): Chainable<string>;

      /** Тонкая обёртка над cy.request для API marketplace-api. */
      apiRequest<T = unknown>(
        method: string,
        path: string,
        body?: unknown,
        opts?: Partial<Cypress.RequestOptions>,
      ): Chainable<Cypress.Response<T>>;

      /**
       * Регистрирует пользователя через API и кладёт токены в localStorage
       * (тот же ключ, что использует AuthSessionStore). После `cy.visit('/me')`
       * фронт сразу считает юзера залогиненным — диалог регистрации/логина
       * НЕ открывается. Возвращает данные созданного юзера.
       */
      register(opts?: Partial<RegisteredUser>): Chainable<RegisteredUser>;

      /** Логин через API + setSession. */
      login(email: string, password: string): Chainable<RegisteredUser>;

      /**
       * Кладёт пару токенов в localStorage до cy.visit(). Должна вызываться
       * через cy.window(): localStorage пустеет между тестами автоматически
       * только в Cypress 12+ — мы не полагаемся на это и чистим явно.
       */
      setSession(tokens: TokenPair, kind?: string): Chainable<void>;

      /** Чистит localStorage перед тестом — на случай оставшейся сессии. */
      clearAuth(): Chainable<void>;
    }
  }
}
