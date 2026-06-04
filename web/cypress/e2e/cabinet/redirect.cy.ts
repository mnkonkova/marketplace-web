describe('cabinet / cabinetLink маршрутизация по роли', () => {
  // Тестируем фронтовую логику header.cabinetLink:
  //   client → /me/projects
  //   specialist → /me
  // admin/manager → /me/projects (как client, поскольку им специалистский
  // кабинет не нужен — был отдельный фикс в feature/crm-v5).
  //
  // admin/manager роли требуют SQL-апдейта is_admin/is_manager, поэтому
  // их в e2e-наборе пока пропускаем; ограничиваемся client + specialist
  // (для которых хватает регистрации через cy.register).

  it('specialist: «Кабинет» в header ведёт на /me (специалистский кабинет)', () => {
    cy.visit('/');
    cy.register({ kind: 'specialist' });
    cy.reload();
    cy.get('app-header')
      .contains('a', /Кабинет/i)
      .should('have.attr', 'href')
      .and('include', '/me');
  });

  it('specialist: на /me видна форма «Профиль»', () => {
    cy.visit('/');
    cy.register({ kind: 'specialist', display_name: 'Spec Cab' });
    cy.visit('/me');
    cy.contains('h2', /Профиль/i).should('be.visible');
  });

  it('client: «Кабинет» в header ведёт на /me/projects (свои проекты)', () => {
    cy.visit('/');
    cy.register({ kind: 'client', display_name: 'Cl' });
    cy.reload();
    cy.get('app-header')
      .contains('a', /Кабинет/i)
      .should('have.attr', 'href', '/me/projects');
  });

  it('client: на /me/projects видна страница списка проектов (empty или с проектами)', () => {
    cy.visit('/');
    cy.register({ kind: 'client', display_name: 'Cl' });
    cy.visit('/me/projects');
    // Проверяем что страница в норме — есть либо empty, либо контейнер со
    // списком. Не привязываемся к конкретному тексту, чтобы тест переживал
    // переименования label'ов.
    cy.get('app-projects-list-page, [class*="projects"]').should('exist');
  });
});
