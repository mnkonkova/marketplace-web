import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { nonEmptySocialLinks, SocialKey } from '@shared/lib/social-links';
import { SocialLinks } from '@entities/specialist/model/specialist.types';

// SocialRowComponent — ряд кликабельных иконок-ссылок на соцсети спеца.
// Используется на странице /specialist/<handle> и в aside. Принимает
// SocialLinks (опционально) и автоматически скрывает пустые поля.
@Component({
  selector: 'app-social-row',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (links().length) {
      <div class="social-row" [class.is-compact]="compact()">
        @for (item of links(); track item.network.key) {
          <a
            [href]="item.url"
            target="_blank"
            rel="noopener nofollow"
            class="social-link"
            [attr.title]="item.network.label"
            [attr.aria-label]="item.network.label"
          >
            <span class="social-icon" aria-hidden="true">{{ item.network.icon }}</span>
            @if (!compact()) {
              <span class="social-label">{{ item.network.label }}</span>
            }
          </a>
        }
      </div>
    }
  `,
  styleUrl: './social-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialRowComponent {
  public readonly social = input<SocialLinks | Partial<Record<SocialKey, string>> | undefined>();
  /** compact=true — только иконки, без подписей (для hero/aside). */
  public readonly compact = input(false);

  public readonly links = computed(() => nonEmptySocialLinks(this.social()));
}
