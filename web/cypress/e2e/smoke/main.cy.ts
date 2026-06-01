describe('smoke / main page', () => {
  it('открывается, видна hero-секция и поиск', () => {
    cy.visit('/');
    cy.contains('h2, .hero-content', /Опишите задачу/i).should('be.visible');
    cy.get('form.hero-search input[name="q"]').should('be.visible');
    cy.contains('button', /Подобрать специалистов/i).should('be.visible');
  });

  it('категории отрисованы (как минимум одна секция)', () => {
    cy.visit('/');
    cy.contains('h2', /Категории специалистов/i).should('be.visible');
    cy.get('app-category-grid').should('have.length.greaterThan', 0);
  });

  it('сабмит поиска ведёт на /search с query-параметром', () => {
    cy.visit('/');
    cy.get('form.hero-search input[name="q"]').type('монтажёр');
    cy.contains('button', /Подобрать специалистов/i).click();
    cy.location('pathname').should('eq', '/search');
    cy.location('search').should('include', 'монтажёр'); // RFC 3986 percent-decoded
  });
});
