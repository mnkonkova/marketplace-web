import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';

// requireRole — guard-factory: пропускает только если auth.role() ∈ roles.
// Если роль ещё не подгружена (например, после reload вкладки) — делает
// один fetchMe() и проверяет снова. Не авторизованных или с чужой ролью
// редиректит на /. Manager дополнительно должен быть is_approved=true.
export function requireRole(...roles: string[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthSessionStore);
    const router = inject(Router);

    if (!auth.isLoggedIn()) {
      void router.navigateByUrl('/');
      return false;
    }

    // Пустой kind — это «роль ещё не знаем», а не «заказчик». role() их не
    // различает: без kind оно возвращает 'client' по умолчанию, и специалист,
    // только что вошедший по паролю (login() сохраняет токены сразу, а kind
    // приезжает отдельным ответом fetchMe), получал отказ и улетал на '/'.
    let role = auth.role();
    if (!role || !auth.kind()) {
      try {
        await firstValueFrom(auth.fetchMe());
        role = auth.role();
      } catch {
        void router.navigateByUrl('/');
        return false;
      }
    }

    if (!roles.includes(role)) {
      void router.navigateByUrl('/');
      return false;
    }

    if (role === 'manager' && !auth.isApproved()) {
      void router.navigateByUrl('/');
      return false;
    }
    return true;
  };
}
