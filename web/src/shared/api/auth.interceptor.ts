import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, shareReplay, switchMap, throwError } from 'rxjs';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { TokenPair } from '@entities/auth/model/auth.types';
import { NzMessageService } from 'ng-zorro-antd/message';

// Флаг чтобы toast «сессия истекла» не спамил при N параллельных 401 —
// показываем один раз пока страница не redirect'нется.
let sessionExpiredToastShown = false;

// Дедупликация in-flight refresh'а. Когда страница открыта с протухшим
// access-токеном, параллельные запросы каждый получают 401 и без дедупа
// каждый запускает свой /auth/refresh — N запросов = N инкрементов в
// rate-limit'е scope "auth". Особенно вредно на /admin/*, где разом
// летит 4-5 GET'ов и одна перезагрузка съедает половину минутного лимита.
//
// Module-level переменная — корректно: HttpInterceptorFn singleton в
// Angular DI, замыкания делят одно состояние процессом.
let pendingRefresh: Observable<TokenPair> | null = null;

function getRefresh(session: AuthSessionStore): Observable<TokenPair> {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = session.refresh().pipe(
    finalize(() => {
      pendingRefresh = null;
    }),
    shareReplay(1),
  );
  return pendingRefresh;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);
  const msg = inject(NzMessageService);
  const token = session.accessToken();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) {
        return throwError(() => err);
      }
      // 401 без refresh-token'а = сессии вообще нет. Гасим тихо, если запрос
      // ушёл на публичную страницу — /auth/* или на прогружаемый компонент,
      // который не требует auth (например, header /me/user на /login).
      if (!session.refreshToken()) {
        return throwError(() => err);
      }
      return getRefresh(session).pipe(
        switchMap(() => {
          const retry = req.clone({
            setHeaders: { Authorization: `Bearer ${session.accessToken()}` },
          });
          return next(retry);
        }),
        catchError(() => {
          // Refresh упал (истёк / отозван / битый) — сессия «мёртвая».
          // Раньше просто чистили session и оставляли юзера на текущей
          // странице с пустым UI (все запросы кидали 401). Теперь: очистка +
          // редирект на /login + один toast, чтобы юзер понял что произошло.
          session.clear();
          if (!sessionExpiredToastShown) {
            sessionExpiredToastShown = true;
            msg.warning('Сессия истекла. Войдите заново.', { nzDuration: 4000 });
            // Сбрасываем флаг при следующем успешном логине через listen на
            // роут change. Простейший вариант — reset через setTimeout, чтобы
            // повторные 401 в течение 4 сек не спамили.
            setTimeout(() => {
              sessionExpiredToastShown = false;
            }, 4000);
          }
          // Не редиректим если уже на /login или /auth/* — иначе бесконечный
          // редирект-лоуп при 401 на самом /auth/refresh.
          const currentPath = router.url.split('?')[0];
          if (!currentPath.startsWith('/login') && !currentPath.startsWith('/auth/')) {
            void router.navigate(['/login'], {
              queryParams: { from_page: currentPath },
            });
          }
          return throwError(() => err);
        }),
      );
    }),
  );
};
