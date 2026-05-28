import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(AuthSessionStore);
  const token = session.accessToken();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401 || !session.refreshToken()) {
        return throwError(() => err);
      }
      return session.refresh().pipe(
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
