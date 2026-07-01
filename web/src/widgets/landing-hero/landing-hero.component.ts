import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';

/**
 * Hero-блок лендинга — заголовок, подзаголовок, 2 CTA. Переиспользуется
 * `/for-clients` и `/for-specialists` через input'ы.
 *
 * accent — цветовая акцентика (для clients vs specialists можно потом
 * подкрутить через data-атрибут).
 */
@Component({
  selector: 'app-landing-hero',
  standalone: true,
  imports: [CommonModule, RouterLink, NzButtonModule],
  template: `
    <section class="landing-hero" [attr.data-accent]="accent()">
      <div class="landing-hero__inner">
        <h1 class="landing-hero__title">{{ title() }}</h1>
        <p class="landing-hero__subtitle">{{ subtitle() }}</p>
        <div class="landing-hero__cta">
          <a
            nz-button
            nzType="primary"
            nzSize="large"
            [routerLink]="primaryHref()"
            [queryParams]="primaryQueryParams()"
            class="landing-hero__cta-primary"
          >
            {{ primaryLabel() }}
          </a>
          @if (secondaryLabel()) {
            <a
              nz-button
              nzSize="large"
              [routerLink]="secondaryHref()"
              class="landing-hero__cta-secondary"
            >
              {{ secondaryLabel() }}
            </a>
          }
        </div>
      </div>
    </section>
  `,
  styleUrl: './landing-hero.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingHeroComponent {
  public readonly title = input.required<string>();
  public readonly subtitle = input<string>('');
  public readonly primaryLabel = input.required<string>();
  public readonly primaryHref = input.required<string | unknown[]>();
  public readonly primaryQueryParams = input<Record<string, string> | null>(null);
  public readonly secondaryLabel = input<string>('');
  public readonly secondaryHref = input<string | unknown[]>('');
  public readonly accent = input<'clients' | 'specialists'>('clients');
}
