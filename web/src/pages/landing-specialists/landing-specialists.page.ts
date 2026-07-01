import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

// Skeleton — контент в следующем коммите v2.1 (шаг #4 из плана).
@Component({
  selector: 'app-landing-specialists-page',
  standalone: true,
  imports: [AppHeaderComponent],
  template: `
    <app-header />
    <main class="stub">
      <h1>Для специалистов</h1>
      <p>Лендинг в разработке.</p>
    </main>
  `,
  styles: [
    `
      .stub {
        max-width: 720px;
        margin: 64px auto;
        padding: 0 24px;
        text-align: center;
        color: var(--text-muted);
      }
      h1 {
        color: var(--text);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingSpecialistsPage {}
