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

// Запрос обновления токена узнаём по адресу. Он проходит через этот же
// перехватчик, и без отдельной ветки его собственный 401 снова запускал
// обновление — то есть подписку на тот самый запрос, который в эту
// секунду падает. Цепочка закольцовывалась, и до «сессия мертва» дело не
// доходило никогда: человек оставался на пустом экране без единого
// сообщения, а сессия так и лежала в браузере.
const isRefreshCall = (url: string): boolean => url.includes('/auth/refresh');

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);
  const msg = inject(NzMessageService);
  const token = session.accessToken();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  // Куда человек хотел попасть — запоминаем сразу, до сетевых задержек.
  // Читать router.url в момент отказа поздно: к этому моменту охрана
  // маршрута уже увела на главную, и «вернуть, где был» теряло смысл.
  //
  // Берём адрес из строки браузера, а не только из роутера: при холодной
  // загрузке защищённой страницы первые запросы уходят раньше, чем роутер
  // успевает на неё встать, и router.url в этот момент ещё '/'. Тогда
  // условие ниже отсекало сохранение, и после входа человека возвращать
  // было некуда — ровно в том случае, ради которого всё и затевалось.
  const routed = router.url.split('?')[0];
  const fromPath = routed !== '/' ? routed : (globalThis.location?.pathname ?? '/');

  // Сессия мертва: обновлять больше нечем. Чистим, говорим об этом вслух и
  // уводим на вход. Молчаливый выход — худший из возможных: человек видит
  // пустые экраны и думает, что сломался сервер.
  const killSession = (err: HttpErrorResponse): Observable<never> => {
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
    // Отдельной страницы входа в приложении нет — вход живёт окном на
    // главной, и прежний переход на несуществующий '/login' просто падал
    // на главную, попутно затирая from_page. Уводим на главную явно и
    // кладём адрес, с которого выбило, чтобы после входа вернуть туда же.
    if (fromPath !== '/' && !fromPath.startsWith('/start')) {
      void router.navigate(['/'], { queryParams: { from_page: fromPath } });
    }
    return throwError(() => err);
  };

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) {
        return throwError(() => err);
      }
      // Отказ на самом обновлении означает ровно одно: обновлять нечем.
      // Второй попытки здесь быть не должно.
      if (isRefreshCall(req.url)) {
        return killSession(err);
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
        // Refresh упал (истёк / отозван / битый) — сессия «мёртвая».
        catchError(() => killSession(err)),
      );
    }),
  );
};
