import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

export interface BackTarget {
  /** URL для navigate. Если null — используется фолбэк родителя. */
  url: string | null;
  /** Подпись для кнопки «← {label}». */
  label: string;
}

/** Карта URL-паттернов → человеческий label. Первый match выигрывает.
 *  Не RegExp ради удобства редактирования. */
const LABEL_MAP: { test: (url: string) => boolean; label: string }[] = [
  { test: (u) => u === '/' || u.startsWith('/?'),                 label: 'На главную' },
  { test: (u) => u.startsWith('/search'),                         label: 'К каталогу' },
  { test: (u) => u.startsWith('/clarify'),                        label: 'Уточнить запрос' },
  { test: (u) => u.startsWith('/feed'),                           label: 'К ленте' },
  { test: (u) => u.startsWith('/me/projects'),                    label: 'К моим проектам' },
  { test: (u) => u.startsWith('/me/specialist/projects'),         label: 'К моим работам' },
  { test: (u) => u.startsWith('/me'),                             label: 'В кабинет' },
  { test: (u) => u.startsWith('/manager/board'),                  label: 'К канбану' },
  { test: (u) => u.startsWith('/manager'),                        label: 'Менеджер · инбокс' },
  { test: (u) => u.startsWith('/admin/board'),                    label: 'К канбану' },
  { test: (u) => u.startsWith('/admin/projects'),                 label: 'Ко всем проектам' },
  { test: (u) => u.startsWith('/admin/dashboard'),                label: 'К дашборду' },
  { test: (u) => u.startsWith('/admin/pipelines'),                label: 'К воронкам' },
  { test: (u) => u.startsWith('/admin/managers'),                 label: 'К менеджерам' },
  { test: (u) => u.startsWith('/admin/productions'),              label: 'К продакшенам' },
  { test: (u) => u.startsWith('/admin'),                          label: 'В админку' },
  { test: (u) => u.startsWith('/specialist/'),                    label: 'К специалисту' },
];

function labelForUrl(url: string): string | null {
  for (const m of LABEL_MAP) if (m.test(url)) return m.label;
  return null;
}

/**
 * Трекает историю навигации внутри SPA. Кнопки «Назад» подписываются
 * через resolveBack() — получают предыдущую страницу с человеческой
 * подписью («К каталогу», «К моим проектам»…) вместо хардкода.
 *
 * Если истории нет (прямой заход по ссылке) — отдаёт null, у консьюмера
 * остаётся свой default. Внешние referrer (заход из Google) тоже = null.
 */
@Injectable({ providedIn: 'root' })
export class NavHistoryService {
  private readonly router = inject(Router);

  /** Последние посещённые URL'ы внутри SPA. Последний — текущий. */
  private stack: string[] = [];

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        // Дедуп: refresh/redirect на тот же URL не плодит лишних записей.
        if (this.stack[this.stack.length - 1] !== e.urlAfterRedirects) {
          this.stack.push(e.urlAfterRedirects);
        }
        if (this.stack.length > 20) this.stack.shift();
      });
  }

  /**
   * Где был пользователь ДО текущей страницы и как назвать «назад».
   * Возвращает null если нет валидной предыстории (прямой заход / только
   * что зашёл на страницу) — консьюмер использует свой default.
   *
   * @param exclude  Паттерн URL'ов, которые не считаются «вернуться к чему-то
   *                 содержательному». Например, со страницы профиля спеца
   *                 «back to профиль того же спеца» — бесполезно; исключаем
   *                 текущий URL и его варианты.
   */
  public resolveBack(exclude?: (url: string) => boolean): BackTarget | null {
    // Берём предыдущий URL: 2-й с конца. -1 = текущий.
    for (let i = this.stack.length - 2; i >= 0; i--) {
      const u = this.stack[i];
      if (exclude && exclude(u)) continue;
      const label = labelForUrl(u);
      if (label) return { url: u, label };
    }
    return null;
  }
}
