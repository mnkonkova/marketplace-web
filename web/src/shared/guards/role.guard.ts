import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';

// requireRole — guard-factory: пропускает, если у человека есть ХОТЯ БЫ
// ОДНА из перечисленных ролей.
//
// Именно «хотя бы одна», а не «главная роль совпала»: менеджер бывает и
// креатором — он ведёт чужие проекты и сам снимает в своих, — а клиент
// бывает специалистом (kind = 'both'). Проверка по одной derived-строке
// role() разворачивала такого человека с собственного кабинета выкладок:
// «менеджер» перекрывал «специалиста», и /me/creator/projects отвечал
// редиректом на главную.
//
// Если роли ещё не подгружены (например, после reload вкладки) — делает
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

    // Пустой kind — это «роли ещё не знаем», а не «заказчик»: без kind
    // человек считался бы клиентом, и специалист, только что вошедший по
    // паролю (login() сохраняет токены сразу, а kind приезжает отдельным
    // ответом fetchMe), получал отказ и улетал на '/'.
    if (!auth.roles().length || !auth.kind()) {
      try {
        await firstValueFrom(auth.fetchMe());
      } catch {
        void router.navigateByUrl('/');
        return false;
      }
    }

    if (!auth.hasRole(...roles)) {
      void router.navigateByUrl('/');
      return false;
    }

    // Неподтверждённый менеджер в CRM не ходит. Но если его сюда пустила
    // другая его роль — специалист в свой кабинет, — отказывать не за
    // что: подтверждение относится к менеджерству, а не к человеку.
    if (!auth.isApproved() && auth.hasRole('manager') && !onlyByOtherRole(auth, roles)) {
      void router.navigateByUrl('/');
      return false;
    }
    return true;
  };
}

/**
 * Пустила ли человека в этот раздел роль, не связанная с менеджерством.
 *
 * Неподтверждённый менеджер не должен попадать в CRM, но его же кабинет
 * специалиста к подтверждению отношения не имеет: подтверждают
 * менеджерство, а не человека.
 */
function onlyByOtherRole(auth: AuthSessionStore, allowed: string[]): boolean {
  return allowed.some((r) => r !== 'manager' && auth.hasRole(r));
}
