import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { RolePickerComponent } from '@shared/ui/role-picker/role-picker.component';
import { SkillPickerComponent } from '@shared/ui/skill-picker/skill-picker.component';

import { Category, Skill } from '@entities/category/model/category.types';
import { CategoryTypeGroup } from '@shared/lib/category-groups';

/**
 * Вкладка «Навыки»: роли (категории), инструменты/форматы и платформы.
 *
 * Публичная страница показывает три первые роли и «ещё N», причём первой
 * всегда идёт основная. Поэтому здесь же — выбор основной роли и мягкая
 * подсказка, когда ролей набрали столько, что специализация перестаёт
 * читаться.
 */
@Component({
  selector: 'app-profile-skills',
  standalone: true,
  imports: [RolePickerComponent, SkillPickerComponent],
  templateUrl: './profile-skills.component.html',
  styleUrl: './profile-skills.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileSkillsComponent {
  public readonly categoryGroups = input<CategoryTypeGroup[]>([]);

  public readonly categories = input<Category[]>([]);

  public readonly selectedCategories = input<Set<string>>(new Set());

  public readonly primaryCategory = input<string>('');

  public readonly tools = input<Skill[]>([]);

  public readonly platforms = input<Skill[]>([]);

  public readonly selectedSkills = input<Set<string>>(new Set());

  public readonly categoryToggled = output<string>();

  public readonly primarySet = output<string>();

  public readonly skillToggled = output<string>();
}
