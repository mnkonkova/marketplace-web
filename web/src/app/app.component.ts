import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { NavHistoryService } from '@shared/nav/nav-history.service';
import { CookieBannerComponent } from '@widgets/cookie-banner/cookie-banner.component';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CookieBannerComponent],
  template: '<router-outlet /><app-cookie-banner />',
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
  `,
})
export class AppComponent {
  // Eager-inject: сервис listenит NavigationEnd с момента создания. Без
  // этого первая навигация (например /feed) не попадала в стек — BackLink
  // создавался уже на /specialist/:id, history был пустым.
  private readonly _nav = inject(NavHistoryService);
}
