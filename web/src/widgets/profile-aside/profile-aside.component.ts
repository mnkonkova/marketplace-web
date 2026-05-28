import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { SpecialistProfile } from '@entities/specialist/model/specialist.types';
import { formatRate } from '@shared/lib/format';

@Component({
  selector: 'app-profile-aside',
  standalone: true,
  imports: [NzCardModule, NzButtonModule, NzTagModule],
  templateUrl: './profile-aside.component.html',
  styleUrl: './profile-aside.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileAsideComponent {
  public readonly profile = input.required<SpecialistProfile>();

  public readonly inProject = input(false);

  public readonly addToProject = output<void>();

  public readonly discuss = output<void>();

  public readonly formatRate = formatRate;
}
