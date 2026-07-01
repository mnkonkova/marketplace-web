import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';

/**
 * Приглашение перейти на лендинги. Показывается на главной под полем
 * поиска только неавторизованным юзерам — тем, кто попал впервые.
 * Условие рендера — в родителе (@if !isLoggedIn()), не в этом компоненте.
 */
@Component({
  selector: 'app-invite-banner',
  standalone: true,
  imports: [RouterLink, NzButtonModule],
  template: `
    <aside class="invite-banner">
      <span class="invite-banner__text">Впервые здесь?</span>
      <div class="invite-banner__actions">
        <a
          nz-button
          nzType="default"
          routerLink="/for-clients"
          (click)="trackClick('clients')"
        >
          Для заказчиков
        </a>
        <a
          nz-button
          nzType="default"
          routerLink="/for-specialists"
          (click)="trackClick('specialists')"
        >
          Для специалистов
        </a>
      </div>
    </aside>
  `,
  styleUrl: './invite-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteBannerComponent {
  public trackClick(audience: 'clients' | 'specialists'): void {
    // TODO(analytics): dispatch 'landing_invite_click' { audience } когда
    // будет подключён продовый analytics-сервис. Сейчас — no-op, чтобы
    // не забыть про метрику воронки на лендинги.
    void audience;
  }
}
