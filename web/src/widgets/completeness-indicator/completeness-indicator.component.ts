import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeProfile, SocialLinks } from '@entities/me/model/me.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';

// Critical, важные и nice-to-have поля профиля. Каждое даёт N% к completeness.
// Сумма = 100. Подобрано так чтобы:
//   • base 40% сразу даётся за заполненный профиль (избегаем «3% пугающе пусто»)
//   • публикация контента ≥ 40% — без портфолио клиенты ничего не увидят
//   • соцсети + bio дают ещё ~20% — это «продающая» часть
interface CompletenessCheck {
  /** Внутренний id для отладки. */
  id: string;
  /** Что отображать юзеру в подсказке. */
  label: string;
  /** Сколько процентов даёт. */
  weight: number;
  /** Готов ли пункт. */
  ok: boolean;
}

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

  public readonly checks = computed<CompletenessCheck[]>(() => {
    const p = this.profile();
    if (!p) return [];
    const port = this.portfolio();
    const social = p.social_links ?? {};
    const anySocial = socialAny(social);
    return [
      {
        id: 'display_name',
        label: 'Имя / название',
        weight: 5,
        ok: !!p.display_name?.trim(),
      },
      {
        id: 'avatar',
        label: 'Аватар или обложка',
        weight: 10,
        ok: !!p.avatar_url?.trim(),
      },
      {
        id: 'bio',
        label: '«О себе» — минимум 100 символов',
        weight: 15,
        ok: (p.bio ?? '').trim().length >= 100,
      },
      {
        id: 'category',
        label: 'Хотя бы одна категория',
        weight: 10,
        ok: (p.categories ?? []).length > 0,
      },
      {
        id: 'production',
        label: 'Студия или «фрилансер»',
        weight: 5,
        ok: !!p.production_id || !!p.is_freelance,
      },
      {
        id: 'rate',
        label: 'Цена услуг',
        weight: 5,
        ok: (p.rate_min ?? 0) > 0 || (p.rate_max ?? 0) > 0,
      },
      {
        id: 'username',
        label: 'Короткий URL (username)',
        weight: 5,
        ok: !!p.username?.trim(),
      },
      {
        id: 'portfolio_1',
        label: 'Минимум одна работа',
        weight: 15,
        ok: port.length >= 1,
      },
      {
        id: 'portfolio_3',
        label: '3+ работы (попадание в топ)',
        weight: 15,
        ok: port.length >= 3,
      },
      {
        id: 'social',
        label: 'Хотя бы одна соцсеть для контакта',
        weight: 10,
        ok: anySocial,
      },
      {
        id: 'contact',
        label: 'Email или телефон',
        weight: 5,
        ok: !!p.contact_email?.trim() || !!p.contact_phone?.trim(),
      },
    ];
  });

  public readonly percent = computed(() => {
    const c = this.checks();
    if (c.length === 0) return 0;
    return c.reduce((sum, x) => sum + (x.ok ? x.weight : 0), 0);
  });

  public readonly missing = computed(() => this.checks().filter((c) => !c.ok));
}

function socialAny(s: SocialLinks): boolean {
  if (!s) return false;
  for (const k of Object.keys(s) as Array<keyof SocialLinks>) {
    if ((s[k] ?? '').toString().trim()) return true;
  }
  return false;
}
