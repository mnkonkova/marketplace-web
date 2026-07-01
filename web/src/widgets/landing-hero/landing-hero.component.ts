import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
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
          <!-- primaryAsButton=true — рендерим button (родитель откроет модалку
               через (primaryClick)). Иначе роутер-ссылка с queryParams. -->
          @if (primaryAsButton()) {
            <button
              nz-button
              nzType="primary"
              nzSize="large"
              type="button"
              (click)="primaryClick.emit($event)"
              class="landing-hero__cta-primary"
            >
              {{ primaryLabel() }}
            </button>
          } @else {
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
          }
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
  // primaryHref опционален только если primaryAsButton=true — тогда
  // клик обрабатывает родитель через (primaryClick).
  public readonly primaryHref = input<string | unknown[]>('');
  public readonly primaryQueryParams = input<Record<string, string> | null>(null);
  public readonly primaryAsButton = input<boolean>(false);
  public readonly primaryClick = output<Event>();
  public readonly secondaryLabel = input<string>('');
  public readonly secondaryHref = input<string | unknown[]>('');
  public readonly accent = input<'clients' | 'specialists'>('clients');
}
