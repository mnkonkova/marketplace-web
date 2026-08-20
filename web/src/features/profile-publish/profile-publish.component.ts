import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { MeProfile } from '@entities/me/model/me.types';
import { ProfileShareComponent } from '@features/profile-share/profile-share.component';
import { specialistHandle } from '@shared/lib/specialist-link';

interface PublishStatus {
  tone: 'draft' | 'pending' | 'approved' | 'rejected';
  title: string;
  text: string;
}

/**
 * Вкладка «Публикация»: короткая ссылка, QR, «как видят клиенты» и статус
 * модерации. Сам блок «Поделиться профилем» переиспользуется как есть —
 * здесь только обёртка со статусом и подписями.
 */
@Component({
  selector: 'app-profile-publish',
  standalone: true,
  imports: [NzIconModule, ProfileShareComponent],
  templateUrl: './profile-publish.component.html',
  styleUrl: './profile-publish.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePublishComponent {
  public readonly profile = input.required<MeProfile>();

  public readonly usernameChange = output<string>();

  private readonly share = viewChild<ProfileShareComponent>('share');

  public readonly publicUrl = computed(() => {
    const p = this.profile();
    return `/specialist/${specialistHandle({ username: p.username, user_id: p.user_id })}`;
  });

  public readonly status = computed<PublishStatus>(() => {
    const p = this.profile();
    if (!p.is_published) {
      return {
        tone: 'draft',
        title: 'Черновик',
        text: 'Профиль виден только вам. Кнопка «Опубликовать» внизу отправит его админу на проверку.',
      };
    }
    if (p.moderation_status === 'pending_review') {
      return {
        tone: 'pending',
        title: 'На проверке у админа',
        text: 'Обычно до 24 часов. После одобрения профиль появится в каталоге и ленте.',
      };
    }
    if (p.moderation_status === 'rejected') {
      return {
        tone: 'rejected',
        title: 'Отклонён модератором',
        text: p.moderation_reason || 'Внесите правки и отправьте на повторную проверку.',
      };
    }
    return {
      tone: 'approved',
      title: 'Опубликован',
      text: 'Профиль в каталоге и ленте. Правки снова уйдут на проверку.',
    };
  });

  /** Прокси к вложенному share-блоку: страница сообщает результат PATCH'а. */
  public onSaveSuccess(): void {
    this.share()?.onSaveSuccess();
  }

  public onSaveError(message: string): void {
    this.share()?.onSaveError(message);
  }
}
