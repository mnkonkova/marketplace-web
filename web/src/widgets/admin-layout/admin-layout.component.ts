import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AdminApi } from '@entities/admin/api/admin.api';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, NzIconModule, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent implements OnInit {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly adminApi = inject(AdminApi);

  public readonly sidebarOpen = signal(false);

  // Счётчик заявок на модерации для бейджа в сайдбаре. Подгружается один
  // раз при маунте layout'а и обновляется на навигации. Лёгкий запрос
  // (COUNT на partial-индексе), кешировать не стоит — статус меняется
  // в реальном времени, нужно свежее значение.
  public readonly pendingModeration = signal(0);

  public constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.sidebarOpen.set(false);
        this.refreshPending();
      });
  }

  public ngOnInit(): void {
    this.refreshPending();
  }

  private refreshPending(): void {
    this.adminApi.pendingModerationCount().subscribe({
      next: (r) => this.pendingModeration.set(r.pending_count),
      // 401/403 — у пользователя нет admin доступа, сайдбар используется
      // под manager-кабинет тоже (хотя по факту roles разные). Тихо игнорим.
      error: () => this.pendingModeration.set(0),
    });
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
