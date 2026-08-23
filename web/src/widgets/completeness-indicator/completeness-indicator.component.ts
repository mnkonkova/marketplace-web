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
 * Что ещё усилит профиль. Правила (пункты и веса) живут в
 * `@shared/lib/profile-completeness` — их читает ещё и страница `/me`,
 * чтобы пометить точкой вкладки с незаполненным.
 *
 * Раньше здесь стояло «Заполненность профиля — 60 %» и список того, чего не
 * хватает, с процентами у каждого пункта. Это оценка и упрёк: человек и так
 * знает, что не дописал, а «плюс пятнадцать процентов» не объясняет, зачем
 * ему это. Поэтому цифры больше нет — осталась полоса (прогресс видно и без
 * числа) и причина у каждого пункта: что изменится в карточке и в поведении
 * заказчика. Причины описывают механику, а не выдуманную статистику.
 */
@Component({
  selector: 'app-completeness-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="completeness" [class.is-full]="percent() === 100">
      <div class="cmp-head">
        <strong>{{ missing().length ? 'Что усилит профиль' : 'Профиль собран полностью' }}</strong>
      </div>
      <div class="cmp-bar">
        <div class="cmp-bar-fill" [style.width.%]="percent()"></div>
      </div>
      @if (missing().length > 0) {
        <ul class="cmp-missing">
          @for (m of missing(); track m.id) {
            <li>
              <b>{{ m.label }}</b>
              <span>{{ m.gain }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="cmp-done">Заказчик видит всё, что помогает выбрать: фото, работы, описание и цену.</p>
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
