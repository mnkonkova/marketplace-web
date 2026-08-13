import { Routes } from '@angular/router';
import { requireRole } from '@shared/guards/role.guard';

export const routes: Routes = [
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
  {
    path: 'me/specialist',
    canActivate: [requireRole('specialist', 'admin')],
    loadComponent: () =>
      import('@pages/me/specialist/specialist-cabinet.page').then((m) => m.SpecialistCabinetPage),
  },
  {
    path: 'manager',
    canActivate: [requireRole('manager', 'admin')],
    loadComponent: () =>
      import('@pages/manager/inbox/inbox.page').then((m) => m.ManagerInboxPage),
  },
  {
    path: 'manager/board',
    canActivate: [requireRole('manager', 'admin')],
    loadComponent: () =>
      import('@pages/manager/board/board.page').then((m) => m.ManagerBoardPage),
  },
  {
    path: 'manager/projects/:id',
    canActivate: [requireRole('manager', 'admin')],
    loadComponent: () =>
      import('@pages/manager/project-detail/manager-project-detail.page').then(
        (m) => m.ManagerProjectDetailPage,
      ),
  },
  {
    path: 'admin/productions',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/productions/productions.page').then((m) => m.AdminProductionsPage),
  },
  {
    path: 'admin/managers',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/managers/managers.page').then((m) => m.AdminManagersPage),
  },
  {
    path: 'admin/users',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/users/users.page').then((m) => m.AdminUsersPage),
  },
  {
    path: 'admin/pipelines',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/pipelines/pipelines-list.page').then((m) => m.AdminPipelinesListPage),
  },
  {
    path: 'admin/pipelines/:id',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/pipelines/pipeline-editor.page').then((m) => m.AdminPipelineEditorPage),
  },
  {
    path: 'admin/projects',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/projects/projects-list.page').then((m) => m.AdminProjectsListPage),
  },
  {
    path: 'admin/board',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/board/board.page').then((m) => m.AdminBoardPage),
  },
  {
    path: 'admin/dashboard',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/dashboard/dashboard.page').then((m) => m.AdminDashboardPage),
  },
  {
    path: 'admin/moderation',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/moderation/moderation.page').then((m) => m.AdminModerationPage),
  },
  {
    path: 'admin/moderation/:id',
    canActivate: [requireRole('admin')],
    loadComponent: () =>
      import('@pages/admin/moderation/moderation-detail.page').then(
        (m) => m.AdminModerationDetailPage,
      ),
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
  // Привязка аккаунта к «Боту Работ». Открывается по одноразовой ссылке из
  // мини-приложения; auth не требуется — страница сама предложит войти или
  // зарегистрироваться, не потеряв код.
  {
    path: 'link/:code',
    loadComponent: () =>
      import('@pages/partner-link/partner-link.page').then((m) => m.PartnerLinkPage),
  },
  { path: '**', redirectTo: '' },
];
