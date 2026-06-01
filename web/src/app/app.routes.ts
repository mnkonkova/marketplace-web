import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('@pages/main/main.page').then((m) => m.MainPage),
  },
  {
    path: 'search',
    loadComponent: () => import('@pages/feed/feed.page').then((m) => m.FeedPage),
  },
  {
    path: 'clarify',
    loadComponent: () => import('@pages/clarify/clarify.page').then((m) => m.ClarifyPage),
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
  {
    path: 'me/projects',
    loadComponent: () =>
      import('@pages/me/projects-list/projects-list.page').then((m) => m.ProjectsListPage),
  },
  {
    path: 'me/projects/:id',
    loadComponent: () =>
      import('@pages/me/project-detail/project-detail.page').then((m) => m.ProjectDetailPage),
  },
  {
    path: 'me/specialist',
    loadComponent: () =>
      import('@pages/me/specialist/specialist-cabinet.page').then((m) => m.SpecialistCabinetPage),
  },
  {
    path: 'manager',
    loadComponent: () =>
      import('@pages/manager/inbox/inbox.page').then((m) => m.ManagerInboxPage),
  },
  {
    path: 'manager/board',
    loadComponent: () =>
      import('@pages/manager/board/board.page').then((m) => m.ManagerBoardPage),
  },
  {
    path: 'manager/projects/:id',
    loadComponent: () =>
      import('@pages/manager/project-detail/manager-project-detail.page').then(
        (m) => m.ManagerProjectDetailPage,
      ),
  },
  {
    path: 'admin/productions',
    loadComponent: () =>
      import('@pages/admin/productions/productions.page').then((m) => m.AdminProductionsPage),
  },
  {
    path: 'admin/managers',
    loadComponent: () =>
      import('@pages/admin/managers/managers.page').then((m) => m.AdminManagersPage),
  },
  {
    path: 'admin/pipelines',
    loadComponent: () =>
      import('@pages/admin/pipelines/pipelines-list.page').then((m) => m.AdminPipelinesListPage),
  },
  {
    path: 'admin/pipelines/:id',
    loadComponent: () =>
      import('@pages/admin/pipelines/pipeline-editor.page').then((m) => m.AdminPipelineEditorPage),
  },
  {
    path: 'admin/projects',
    loadComponent: () =>
      import('@pages/admin/projects/projects-list.page').then((m) => m.AdminProjectsListPage),
  },
  {
    path: 'admin/board',
    loadComponent: () =>
      import('@pages/admin/board/board.page').then((m) => m.AdminBoardPage),
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
  { path: '**', redirectTo: '' },
];
