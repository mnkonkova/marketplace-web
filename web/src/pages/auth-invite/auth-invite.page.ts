import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzMessageService } from 'ng-zorro-antd/message';

import { AdminApi } from '@entities/admin/api/admin.api';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-auth-invite',
  standalone: true,
  imports: [CommonModule, NzSpinModule, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-invite.page.html',
  styleUrl: './auth-invite.page.scss',
})
export class AuthInvitePage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly api = inject(AdminApi);

  private readonly auth = inject(AuthSessionStore);

  private readonly msg = inject(NzMessageService);

  public readonly state = signal<'loading' | 'ok' | 'error'>('loading');

  public ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('error');
      return;
    }
    this.api.redeemInvite(token).subscribe({
      next: (r) => {
        // имитируем auth.save через прямой вызов save
        this.auth.save(r.tokens, 'client');
        this.auth.fetchMe().subscribe();
        this.state.set('ok');
        this.msg.success('Вы вошли в кабинет');
        setTimeout(() => void this.router.navigate(['/me/projects']), 800);
      },
      error: () => this.state.set('error'),
    });
  }
}
