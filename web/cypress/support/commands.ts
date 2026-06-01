import type { RegisteredUser, TokenPair } from './index';

const STORAGE_KEY = 'marketpclce.auth.v1';

const apiBase = () => Cypress.env('apiBaseUrl') as string;

Cypress.Commands.add('uniqueEmail', (prefix = 'cy') => {
  const rand = Math.random().toString(36).slice(2, 8);
  return cy.wrap(`${prefix}-${Date.now()}-${rand}@e2e.local`);
});

Cypress.Commands.add('apiRequest', (method, path, body, opts) => {
  return cy.request({
    method,
    url: `${apiBase()}${path}`,
    body: body as Cypress.RequestBody,
    failOnStatusCode: false,
    ...opts,
  });
});

Cypress.Commands.add('register', (overrides = {}) => {
  // chain: сначала генерим email (если не задан), потом дёргаем API.
  const emailChain = overrides.email ? cy.wrap(overrides.email) : cy.uniqueEmail();
  return emailChain.then((email) => {
    const password = overrides.password ?? 'Password123!';
    const kind = overrides.kind ?? 'specialist';
    const display_name = overrides.display_name ?? 'Cy User';
    return cy
      .apiRequest<{ user_id: string; tokens: TokenPair }>('POST', '/auth/register', {
        email,
        password,
        kind,
        display_name,
      })
      .then((res) => {
        expect(res.status, 'register status').to.eq(201);
        const user: RegisteredUser = {
          email,
          password,
          user_id: res.body.user_id,
          tokens: res.body.tokens,
          kind,
          display_name,
        };
        return cy.setSession(user.tokens, kind).then(() => user);
      });
  });
});

Cypress.Commands.add('login', (email, password) => {
  return cy
    .apiRequest<TokenPair>('POST', '/auth/login', { login: email, password })
    .then((res) => {
      expect(res.status, 'login status').to.eq(200);
      const user: RegisteredUser = {
        email,
        password,
        user_id: '',
        tokens: res.body,
        kind: 'specialist',
        display_name: '',
      };
      return cy.setSession(user.tokens).then(() => user);
    });
});

Cypress.Commands.add('setSession', (tokens, kind) => {
  // visit любой страницы перед setItem, иначе localStorage недоступен.
  cy.window({ log: false }).then((win) => {
    win.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        kind: kind ?? '',
      }),
    );
  });
});

Cypress.Commands.add('clearAuth', () => {
  cy.window({ log: false }).then((win) => {
    win.localStorage.clear();
    win.sessionStorage.clear();
  });
});

export {};
