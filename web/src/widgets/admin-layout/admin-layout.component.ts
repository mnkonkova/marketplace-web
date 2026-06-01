import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, NzIconModule, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  public readonly sidebarOpen = signal(false);

  public constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.sidebarOpen.set(false));
  }

  public toggleSidebar(): void {
    this.sidebarOpen.set(!this.sidebarOpen());
  }

  public closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  public logout(): void {
    this.auth.clear();
    void this.router.navigateByUrl('/');
  }
}
