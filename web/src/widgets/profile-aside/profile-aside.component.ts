import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { SpecialistProfile } from '@entities/specialist/model/specialist.types';
import { formatPublicRate } from '@shared/lib/format';
import { nonEmptySocialLinks } from '@shared/lib/social-links';
import { SocialRowComponent } from '@widgets/social-row/social-row.component';
import { ShareCardComponent } from '@widgets/share-card/share-card.component';

@Component({
  selector: 'app-profile-aside',
  standalone: true,
  imports: [NzCardModule, NzButtonModule, NzTagModule, SocialRowComponent, ShareCardComponent],
  templateUrl: './profile-aside.component.html',
  styleUrl: './profile-aside.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileAsideComponent {
  public readonly profile = input.required<SpecialistProfile>();

  public readonly inProject = input(false);

  /** Ссылка на эту же страницу — для «Поделиться»/QR. */
  public readonly shareUrl = input<string>('');

  /** Главные роли одной строкой — подпись в предпросмотре ссылки. */
  public readonly shareRoles = input<string>('');

  /** Обложка предпросмотра: постер флагмана, иначе аватар. */
  public readonly shareCover = input<string>('');

  /**
   * Есть ли хоть один заполненный контакт. Раньше карточка «Где найти»
   * рендерилась по факту наличия объекта social_links — а он приходит
   * всегда, просто с пустыми полями. Получалась пустая рамка с заголовком.
   */
  public readonly hasContacts = computed(
    () => nonEmptySocialLinks(this.profile().social_links).length > 0,
  );

  public readonly rateLabel = computed(() => {
    const p = this.profile();
    return formatPublicRate(p.rate_min, p.rate_max, p.currency);
  });

  public readonly worksCount = computed(() => this.profile().portfolio?.length ?? 0);
}
