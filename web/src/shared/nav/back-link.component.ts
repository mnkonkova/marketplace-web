import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs/operators';

import { NavHistoryService, labelForUrl } from './nav-history.service';

/**
 * `<app-back-link>` — кнопка «← {label}», которая знает откуда пришёл
 * пользователь. Если NavHistoryService видит предыдущую страницу с
 * известным URL-паттерном — берёт label оттуда. Иначе использует
 * `[defaultUrl]` (как fallback на прямой заход / реферал извне).
 *
 * Label НИКОГДА не хардкодится в шаблоне — резолвится из URL по карте
 * LABEL_MAP в nav-history.service. Чтобы добавить новый — одна правка
 * в карте.
 *
 * Пример:
 * ```html
 * <app-back-link defaultUrl="/search" />
 * ```
 * Зашёл с `/feed` → «К ленте». Зашёл напрямую → «К каталогу» (LABEL_MAP
 * для /search). Зашёл из /admin/projects → «Ко всем проектам».
 */
@Component({
  selector: 'app-back-link',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back-link" [href]="target().url || defaultUrl()" (click)="go($event)">
      ← {{ target().label }}
    </a>
  `,
  styles: [`
    .back-link {
      display: inline-block;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      cursor: pointer;
    }
    .back-link:hover { color: var(--accent); }
  `],
})
export class BackLinkComponent {
  public readonly defaultUrl = input.required<string>();
  /** URL-паттерны, которые НЕ должны попадать в «back-цель» — сама страница
   *  и/или соседи, к которым возврат бессмыслен/зациклен. Принимает строку
   *  или массив (любой match скрывает запись из истории). */
  public readonly excludePrefix = input<string | string[] | null>(null);

  private readonly history = inject(NavHistoryService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** `?from_page=` из URL текущей страницы — самый надёжный источник
   *  «откуда пришёл»: переживает refresh и открытие в новой вкладке. */
  private readonly fromPage = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('from_page') || null)),
    { initialValue: null as string | null },
  );

  public readonly target = computed(() => {
    // 1. Явный from_page в URL — приоритет (производитель навигации сказал
    //    куда возвращать).
    const fromPage = this.fromPage();
    if (fromPage) {
      return { url: fromPage, label: labelForUrl(fromPage) ?? 'Назад' };
    }
    // 2. История навигации — fallback для случаев, где producer ещё не
    //    обновлён под from_page.
    const exclude = this.excludePrefix();
    const prefixes = exclude == null ? [] : Array.isArray(exclude) ? exclude : [exclude];
    const back = this.history.resolveBack(
      prefixes.length ? (u) => prefixes.some((p) => u.startsWith(p)) : undefined,
    );
    if (back) return back;
    // 3. Дефолт — прямой заход / реферал извне.
    return {
      url: null as string | null,
      label: labelForUrl(this.defaultUrl()) ?? 'Назад',
    };
  });

  public go(ev: MouseEvent): void {
    ev.preventDefault();
    const t = this.target();
    void this.router.navigateByUrl(t.url ?? this.defaultUrl());
  }
}
