import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeProfile } from '@entities/me/model/me.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import {
  CompletenessCheck,
  completenessChecks,
  completenessPercent,
} from '@shared/lib/profile-completeness';

/**
 * Прогресс заполненности профиля. Сами правила (пункты и веса) живут в
 * `@shared/lib/profile-completeness` — их читает ещё и страница `/me`,
 * чтобы пометить точкой вкладки с незаполненным.
 */
@Component({
  selector: 'app-completeness-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="completeness" [class.is-full]="percent() === 100">
      <div class="cmp-head">
        <strong>Заполненность профиля</strong>
        <span class="cmp-percent" [class.is-low]="percent() < 60">
          {{ percent() }}%
        </span>
      </div>
      <div class="cmp-bar">
        <div class="cmp-bar-fill" [style.width.%]="percent()"></div>
      </div>
      @if (missing().length > 0) {
        <div class="cmp-missing">
          <span class="cmp-missing-head">Что добавить:</span>
          <ul>
            @for (m of missing(); track m.id) {
              <li>— {{ m.label }} <span class="muted">(+{{ m.weight }}%)</span></li>
            }
          </ul>
        </div>
      } @else {
        <p class="cmp-done">🎉 Профиль полностью готов — клиенты увидят максимум.</p>
      }
    </div>
  `,
  styleUrl: './completeness-indicator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompletenessIndicatorComponent {
  public readonly profile = input.required<MeProfile | null>();
  public readonly portfolio = input<PortfolioItem[]>([]);

  public readonly checks = computed<CompletenessCheck[]>(() =>
    completenessChecks(this.profile(), this.portfolio()),
  );

  public readonly percent = computed(() => completenessPercent(this.checks()));

  public readonly missing = computed(() => this.checks().filter((c) => !c.ok));
}
