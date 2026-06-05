import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { NavHistoryService } from './nav-history.service';

/**
 * `<app-back-link>` — кнопка «← {label}», которая знает откуда пришёл
 * пользователь. Если NavHistoryService видит предыдущую страницу с
 * известным URL-паттерном — берёт label оттуда. Иначе использует
 * `[defaultUrl]` + `[defaultLabel]` (хардкод как fallback на прямой заход).
 *
 * Пример:
 * ```html
 * <app-back-link defaultUrl="/search" defaultLabel="К каталогу" />
 * ```
 * Зашёл с `/feed` → кнопка покажет «К ленте» и ведёт на /feed.
 * Зашёл напрямую → «К каталогу» и ведёт на /search.
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
  public readonly defaultLabel = input<string>('Назад');
  /** URL текущей страницы (или паттерн), который НЕ должен попадать в «back-цель».
   *  Полезно для деталей: вернуться к самому себе бессмысленно. */
  public readonly excludePrefix = input<string | null>(null);

  private readonly history = inject(NavHistoryService);
  private readonly router = inject(Router);

  public readonly target = computed(() => {
    const exclude = this.excludePrefix();
    const back = this.history.resolveBack(
      exclude ? (u) => u.startsWith(exclude) : undefined,
    );
    return back ?? { url: null, label: this.defaultLabel() };
  });

  public go(ev: MouseEvent): void {
    ev.preventDefault();
    const t = this.target();
    void this.router.navigateByUrl(t.url ?? this.defaultUrl());
  }
}
