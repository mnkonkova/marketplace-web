import { inject } from '@angular/core';
import { Router, Routes, UrlTree } from '@angular/router';
import { requireRole } from '@shared/guards/role.guard';
import { unsavedChangesGuard } from '@shared/guards/unsaved-changes.guard';

// Старый адрес канбана — это раздел проектов, открытый канбаном.
// redirectTo строкой сюда не годится: query-параметр в ней не записать, а
// вид живёт именно в нём.
function boardView(path: string): UrlTree {
  return inject(Router).createUrlTree([path], { queryParams: { view: 'board' } });
}

export const routes: Routes = [
  // Онбординг: развилка «заказчик / специалист» и мастер профиля.
  // Мастер собирает те же данные и тем же API, что и кабинет.
  // Публичный: с лендингов сюда приходят ещё не зарегистрированными, а
  // ?role=specialist пропускает развилку — роль уже выбрана кнопкой.
  {
    path: 'start',
    loadComponent: () => import('@pages/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    path: '',
    loadComponent: () => import('@pages/main/main.page').then((m) => m.MainPage),
  },
  {
    path: 'search',
    loadComponent: () =>
      import('@pages/search-results/search-results.page').then((m) => m.SearchResultsPage),
  },
  // /feed — тикток-лента «Смотреть всех». v2.1 фильтрованный список вывели
  // на /search (карточки), а тикток-скролл оставили для режима «просто
  // всё подряд» с главной кнопки «Смотреть всех».
  {
    path: 'feed',
    loadComponent: () => import('@pages/feed/feed.page').then((m) => m.FeedPage),
  },
  // /clarify (LLM-диалог) убран из воронки в v2.1 — юзер идёт с главной сразу
  // на /search. Оставляем redirect чтобы старые письма/закладки не 404-или.
  // prefix — потому что /clarify?q=... → /search?q=... сохраняет queryParams.
  {
    path: 'clarify',
    redirectTo: '/search',
    pathMatch: 'prefix',
  },
  // Публичные лендинги — вход в воронку регистрации. Не требуют auth.
  {
    path: 'for-clients',
    loadComponent: () =>
      import('@pages/landing-clients/landing-clients.page').then((m) => m.LandingClientsPage),
  },
  {
    path: 'for-specialists',
    loadComponent: () =>
      import('@pages/landing-specialists/landing-specialists.page').then(
        (m) => m.LandingSpecialistsPage,
      ),
  },
  {
    path: 'specialist/:id',
    loadComponent: () =>
      import('@pages/specialist-profile/specialist-profile.page').then(
        (m) => m.SpecialistProfilePage,
      ),
  },
  {
    path: 'me',
    // Кабинет редактирует профиль специалиста, у заказчика такого профиля
    // нет: без гарда он попадал сюда и видел «Профиль не найден или
    // недоступен» вместо внятного отказа.
    canActivate: [requireRole('specialist', 'admin')],
    // Форма сохраняется по кнопке, поэтому уход со страницы с правками
    // подтверждается модалкой (см. unsavedChangesGuard).
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('@pages/cabinet/cabinet.page').then((m) => m.CabinetPage),
  },
  // Клиентские страницы: проверка не по role, а просто isLoggedIn — бэк
  // фильтрует по client_user_id, чужие проекты увидеть нельзя. Кроме того
  // у клиентов role=client изначально и для большинства гарда хватит.
  {
    path: 'me/projects',
    canActivate: [requireRole('client', 'specialist', 'manager', 'admin')],
    loadComponent: () =>
      import('@pages/me/projects-list/projects-list.page').then((m) => m.ProjectsListPage),
  },
  {
    path: 'me/projects/:id',
    canActivate: [requireRole('client', 'specialist', 'manager', 'admin')],
    loadComponent: () =>
      import('@pages/me/project-detail/project-detail.page').then((m) => m.ProjectDetailPage),
  },
  // Воронка заказа «под ключ». Два маршрута на один экран: /new — пустая
  // воронка с нулевого шага, /:id — уже созданный заказ. Шаг у него не в
  // URL, а в статусе заказа: воронку проходят один раз и в одну сторону,
  // и ссылка «на третий шаг» вела бы в состояние, которого нет.
  {
    path: 'me/orders/new',
    canActivate: [requireRole('client', 'specialist', 'manager', 'admin')],
    loadComponent: () =>
      import('@pages/me/order-funnel/order-funnel.page').then((m) => m.OrderFunnelPage),
  },
  {
    path: 'me/orders/:id',
    canActivate: [requireRole('client', 'specialist', 'manager', 'admin')],
    loadComponent: () =>
      import('@pages/me/order-funnel/order-funnel.page').then((m) => m.OrderFunnelPage),
  },
  // Проекты, где я в составе. Собственный вход в кабинете специалиста:
  // раньше на выкладки можно было попасть только по ссылке из карточек
  // «Назначенные проекты», а это назначения по воронке — не то же самое.
  {
    path: 'me/creator/projects',
    canActivate: [requireRole('specialist', 'admin')],
    loadComponent: () =>
      import('@pages/me/creator-projects/creator-projects.page').then((m) => m.CreatorProjectsPage),
  },
  // Вход из мини-аппа Telegram. БЕЗ guard'а намеренно: человек сюда
  // приходит без сессии — её здесь и выдают. Бот в адресе: от него
  // зависит роль нового человека, и спрашивать её вторым экраном
  // незачем — выбор сделан тем, в какого бота написали.
  {
    path: 'tg',
    loadComponent: () => import('@pages/tg/tg-entry.page').then((m) => m.TgEntryPage),
  },
  {
    path: 'tg/:bot',
    loadComponent: () => import('@pages/tg/tg-entry.page').then((m) => m.TgEntryPage),
  },
  // Заявки «под ключ»: что предлагают снять и чем на это ответить.
  // Приглашение больше не именное — заявка уходит рассылкой всем
  // креаторам, — поэтому это список, а не письмо с одной кнопкой.
  {
    path: 'me/creator/invitations',
    canActivate: [requireRole('specialist', 'admin')],
    loadComponent: () =>
      import('@pages/me/creator-invitations/creator-invitations.page').then(
        (m) => m.CreatorInvitationsPage,
      ),
  },
  // Проект глазами креатора: его выкладки, чеклист и цифры по его роликам.
  // Отдельный маршрут от /me/projects/:id — там взгляд заказчика, и данные
  // приходят из других ручек (/me/creator/...).
  {
    path: 'me/creator/projects/:id',
    canActivate: [requireRole('specialist', 'admin')],
    loadComponent: () =>
      import('@pages/me/creator-project/creator-project.page').then((m) => m.CreatorProjectPage),
  },
  {
    path: 'me/specialist',
    canActivate: [requireRole('specialist', 'admin')],
    loadComponent: () =>
      import('@pages/me/specialist/specialist-cabinet.page').then((m) => m.SpecialistCabinetPage),
  },
  // CRM: одна оболочка на админа и менеджера, роль решает только состав
  // сайдбара. Оболочка стоит здесь, на родительском маршруте, а не внутри
  // страниц: пока каждая страница оборачивала себя сама, половина
  // админских экранов открывалась в менеджерском кабинете — и заметить
  // это можно было, только зайдя на каждую.
  //
  // canActivateChild, а не canActivate на каждом ребёнке: правило доступа
  // здесь одно на всю ветку, и повторённое двенадцать раз оно рано или
  // поздно разъедется.
  {
    path: 'manager',
    canActivateChild: [requireRole('manager', 'admin')],
    loadComponent: () =>
      import('@widgets/crm-layout/crm-layout.component').then((m) => m.CrmLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@pages/manager/inbox/inbox.page').then((m) => m.ManagerInboxPage),
      },
      {
        // Проекты менеджера: список и канбан — один раздел, вид в ?view.
        // У проекта с креаторами воронки нет, и на канбане он не
        // появляется вовсе, поэтому список остаётся видом по умолчанию.
        path: 'projects',
        loadComponent: () =>
          import('@pages/manager/projects/manager-projects.page').then(
            (m) => m.ManagerProjectsPage,
          ),
      },
      // Канбан жил отдельным адресом, и он уже разошёлся по закладкам и
      // ссылкам в переписке. Ведём его на тот же раздел нужным видом.
      { path: 'board', redirectTo: () => boardView('/manager/projects') },
      {
        // Библиотека чеклистов: из чего собирается чеклист выкладки.
        // В сайдбаре менеджера её нет — ведёт её админ, — но прямая
        // ссылка работает: на неё ссылается вкладка «Материалы» в проекте.
        path: 'templates',
        loadComponent: () =>
          import('@pages/manager/templates/templates.page').then((m) => m.ManagerTemplatesPage),
      },
      {
        path: 'projects/:id',
        loadComponent: () =>
          import('@pages/manager/project-detail/manager-project-detail.page').then(
            (m) => m.ManagerProjectDetailPage,
          ),
      },
    ],
  },
  {
    path: 'admin',
    canActivateChild: [requireRole('admin')],
    loadComponent: () =>
      import('@widgets/crm-layout/crm-layout.component').then((m) => m.CrmLayoutComponent),
    children: [
      {
        // Сводка — корень раздела, а не /admin/dashboard: адрес «админка»
        // должен куда-то вести, и вёл он в никуда.
        path: '',
        loadComponent: () =>
          import('@pages/admin/dashboard/dashboard.page').then((m) => m.AdminDashboardPage),
      },
      { path: 'dashboard', redirectTo: '', pathMatch: 'full' },
      {
        path: 'projects',
        loadComponent: () =>
          import('@pages/admin/projects/projects-list.page').then((m) => m.AdminProjectsListPage),
      },
      { path: 'board', redirectTo: () => boardView('/admin/projects') },
      {
        path: 'moderation',
        loadComponent: () =>
          import('@pages/admin/moderation/moderation.page').then((m) => m.AdminModerationPage),
      },
      {
        path: 'moderation/:id',
        loadComponent: () =>
          import('@pages/admin/moderation/moderation-detail.page').then(
            (m) => m.AdminModerationDetailPage,
          ),
      },
      {
        // Команда: кто в CRM и с какими правами. Прежний адрес назывался
        // /admin/managers — по единственной роли, которую тогда выдавали.
        path: 'team',
        loadComponent: () =>
          import('@pages/admin/managers/managers.page').then((m) => m.AdminManagersPage),
      },
      { path: 'managers', redirectTo: 'team', pathMatch: 'full' },
      {
        // Журнал: кто что менял. До него разбор спорного случая шёл в логи
        // сервера — то есть к тому, у кого есть к ним доступ.
        path: 'audit',
        loadComponent: () => import('@pages/admin/audit/audit.page').then((m) => m.AdminAuditPage),
      },
      {
        path: 'specialists',
        loadComponent: () =>
          import('@pages/admin/people/people-soon.page').then((m) => m.AdminPeopleSoonPage),
        data: { section: 'specialists' },
      },
      {
        path: 'clients',
        loadComponent: () =>
          import('@pages/admin/people/people-soon.page').then((m) => m.AdminPeopleSoonPage),
        data: { section: 'clients' },
      },
      {
        // Все пользователи одним списком. В сайдбаре его больше нет — там
        // «Специалисты» и «Клиенты», — но сам экран остаётся: ролями и
        // блокировкой управляют только отсюда, и до разделения он
        // единственный, где это можно сделать.
        path: 'users',
        loadComponent: () => import('@pages/admin/users/users.page').then((m) => m.AdminUsersPage),
      },
      {
        // Прайс креаторов: цена креатора для заказчика и доля самого креатора.
        path: 'tariff',
        loadComponent: () =>
          import('@pages/admin/tariff/tariff.page').then((m) => m.AdminTariffPage),
      },
      {
        // Шаблоны документов: договоры, акты, NDA. Версии и архив — как у
        // прайса.
        path: 'documents',
        loadComponent: () =>
          import('@pages/admin/documents/documents.page').then((m) => m.AdminDocumentsPage),
      },
      {
        // Чеклисты креаторов: что креатор отмечает перед сдачей ссылок.
        // Ведёт админ — пункты общие для всех проектов.
        path: 'checklists',
        loadComponent: () =>
          import('@pages/admin/checklists/checklists.page').then((m) => m.AdminChecklistsPage),
      },
      {
        path: 'pipelines',
        loadComponent: () =>
          import('@pages/admin/pipelines/pipelines-list.page').then(
            (m) => m.AdminPipelinesListPage,
          ),
      },
      {
        path: 'pipelines/:id',
        loadComponent: () =>
          import('@pages/admin/pipelines/pipeline-editor.page').then(
            (m) => m.AdminPipelineEditorPage,
          ),
      },
      {
        path: 'productions',
        loadComponent: () =>
          import('@pages/admin/productions/productions.page').then((m) => m.AdminProductionsPage),
      },
    ],
  },
  {
    path: 'auth/invite',
    loadComponent: () =>
      import('@pages/auth-invite/auth-invite.page').then((m) => m.AuthInvitePage),
  },
  {
    path: 'verify',
    loadComponent: () => import('@pages/verify/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: 'auth/reset',
    loadComponent: () =>
      import('@pages/reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'privacy',
    loadComponent: () => import('@pages/legal/privacy.page').then((m) => m.PrivacyPage),
  },
  {
    path: 'terms',
    loadComponent: () => import('@pages/legal/terms.page').then((m) => m.TermsPage),
  },
  // Оферта больше не отдельный документ — она стала частью соглашения
  // (разделы 12+). Редирект, а не удаление маршрута: ссылка на /offer уже
  // published — она стоит в подвале у тех, кто держит вкладку открытой, и
  // в письмах. Страница 404 на юридическом документе выглядит так, будто
  // условия спрятали.
  { path: 'offer', redirectTo: 'terms', pathMatch: 'full' },
  // Привязка аккаунта к «Ботработу». Открывается по одноразовой ссылке из
  // мини-приложения; auth не требуется — страница сама предложит войти или
  // зарегистрироваться, не потеряв код.
  {
    path: 'link/:code',
    loadComponent: () =>
      import('@pages/partner-link/partner-link.page').then((m) => m.PartnerLinkPage),
  },
  { path: '**', redirectTo: '' },
];
