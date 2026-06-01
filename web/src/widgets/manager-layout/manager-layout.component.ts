import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-manager-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, NzIconModule, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-layout.component.html',
  styleUrl: './manager-layout.component.scss',
})
export class ManagerLayoutComponent {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  public logout(): void {
    this.auth.clear();
    void this.router.navigateByUrl('/');
  }
}
