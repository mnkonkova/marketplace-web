describe('auth / register & login', () => {
  it('cy.register создаёт юзера и устанавливает сессию (API + localStorage)', () => {
    // visit перед register нужен, чтобы появилось окно с localStorage.
    cy.visit('/');
    cy.register({ kind: 'specialist', display_name: 'Cy Reg User' }).then((user) => {
      expect(user.tokens.access_token).to.be.a('string').and.not.empty;
      cy.window().then((win) => {
        const raw = win.localStorage.getItem('marketpclce.auth.v1');
        expect(raw, 'session in localStorage').to.be.a('string');
        const parsed = JSON.parse(raw!);
        expect(parsed.access_token).to.eq(user.tokens.access_token);
      });
    });
  });

  it('после регистрации хедер показывает "Кабинет" вместо "Войти"', () => {
    cy.visit('/');
    cy.register();
    // setSession кладёт токен в текущее окно; чтобы хедер перечитал сигнал,
    // делаем reload — AuthSessionStore читает localStorage в конструкторе.
    cy.reload();
    cy.get('app-header').contains('a', /Кабинет/i).should('be.visible');
    cy.get('app-header').contains('button', /Войти/i).should('not.exist');
  });

  it('второй register с тем же email возвращает 400 invalid_input (anti-enumeration)', () => {
    cy.visit('/');
    cy.uniqueEmail().then((email) => {
      cy.register({ email, password: 'Password123!' });
      cy.apiRequest('POST', '/auth/register', {
        email,
        password: 'Password123!',
        kind: 'client',
        display_name: 'Dup',
      }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body).to.have.property('code', 'invalid_input');
      });
    });
  });

  it('логин зарегистрированным юзером через UI-диалог', () => {
    cy.visit('/');
    // регистрируем через API (быстро), потом разлогиниваемся, потом — UI-логин
    cy.uniqueEmail().then((email) => {
      const password = 'Password123!';
      cy.register({ email, password, display_name: 'UI Login' });
      cy.clearAuth();
      cy.reload();

      cy.get('app-header').contains('button', /Войти/i).click();
      // ng-zorro nz-modal маунтится в body — снаружи app-root
      cy.get('.ant-modal-content').should('be.visible');
      cy.get('.ant-modal-content input[placeholder="Email"]').type(email);
      cy.get('.ant-modal-content input[formcontrolname="password"]').type(password);
      cy.get('.ant-modal-content').contains('button', /Войти/i).click();

      cy.get('.ant-modal-content').should('not.exist');
      cy.get('app-header').contains('a', /Кабинет/i).should('be.visible');
    });
  });
});
