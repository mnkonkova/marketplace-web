import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { Skill } from '@entities/category/model/category.types';

/**
 * Чипы навыков: инструменты/форматы и платформы. Общий для кабинета и
 * мастера регистрации — набор данных и поведение там одинаковые.
 *
 * Состояния не держит: что выбрано, решает владелец.
 */
@Component({
  selector: 'app-skill-picker',
  standalone: true,
  imports: [NzIconModule],
  templateUrl: './skill-picker.component.html',
  styleUrl: './skill-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillPickerComponent {
  public readonly tools = input<Skill[]>([]);

  public readonly platforms = input<Skill[]>([]);

  public readonly selectedSkills = input<Set<string>>(new Set());

  public readonly toggled = output<string>();
}
