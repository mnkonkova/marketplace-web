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
