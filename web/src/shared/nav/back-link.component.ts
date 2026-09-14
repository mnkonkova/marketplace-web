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
      <span class="back-link__arrow" aria-hidden="true">←</span>
      <span class="back-link__label">{{ target().label }}</span>
    </a>
  `,
  styles: [`
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 18px;
      margin: 4px 0;
      border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
      border-radius: 999px;
      background: var(--surface, #fff);
      color: var(--text-muted);
      text-decoration: none;
      font-size: 15px;
      font-weight: 500;
      line-height: 1;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
    }
    .back-link__arrow {
      display: inline-flex;
      font-size: 18px;
      line-height: 1;
      transition: transform 0.15s ease;
    }
    .back-link:hover {
      color: var(--text);
      border-color: var(--accent);
      background: var(--surface-hover, rgba(0, 0, 0, 0.03));
    }
    .back-link:hover .back-link__arrow {
      transform: translateX(-3px);
    }
    .back-link:active {
      transform: translateY(1px);
    }
    .back-link:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
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
