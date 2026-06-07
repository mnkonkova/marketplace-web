import { NavigationExtras, Router } from '@angular/router';

/**
 * Подмешивает `?from_page=<current url>` в queryParams для router.navigate().
 *
 * Зачем: BackLinkComponent читает этот параметр и точно возвращает
 * пользователя туда, откуда пришёл — без зависимости от истории
 * браузера (которая ломается на refresh / deep-link / открытии
 * в новой вкладке).
 *
 * Пример:
 *   this.router.navigate(['/specialist', id], withFromPage(this.router));
 */
export function withFromPage(router: Router, extras?: NavigationExtras): NavigationExtras {
  return {
    ...(extras ?? {}),
    queryParams: {
      ...(extras?.queryParams ?? {}),
      from_page: router.url,
    },
  };
}
