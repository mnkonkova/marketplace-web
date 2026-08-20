import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';

import { ProfileForm } from '@entities/me/model/profile-form';
import { SOCIAL_NETWORKS } from '@shared/lib/social-links';

/**
 * Вкладка «Контакты»: скрытые контакты для заявок + публичные соцсети.
 * Как и остальные вкладки, состояние не хранит — пишет в форму страницы.
 */
@Component({
  selector: 'app-profile-contacts',
  standalone: true,
  imports: [FormsModule, NzInputModule],
  templateUrl: './profile-contacts.component.html',
  styleUrl: './profile-contacts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileContactsComponent {
  public readonly form = input.required<ProfileForm>();

  public readonly socialNetworks = SOCIAL_NETWORKS;

  public get f(): ProfileForm {
    return this.form();
  }
}
