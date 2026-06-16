import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, finalize, shareReplay, switchMap, throwError } from 'rxjs';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { TokenPair } from '@entities/auth/model/auth.types';

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
  const token = session.accessToken();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401 || !session.refreshToken()) {
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
          session.clear();
          return throwError(() => err);
        }),
      );
    }),
  );
};
