import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';

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
  imports: [NzIconModule],
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

  /**
   * Порядок такой же, как на публичной: основная роль первой, остальные —
   * как их вернёт бэк (ORDER BY is_primary DESC, sort_order, title).
   */
  public readonly selectedList = computed(() => {
    const selected = this.selectedCategories();
    const primary = this.primaryCategory();
    const titles = new Map(this.categories().map((c) => [c.code, c.title]));
    const codes = [...selected];
    codes.sort((a, b) => {
      if (a === primary) return -1;
      if (b === primary) return 1;
      return (titles.get(a) ?? a).localeCompare(titles.get(b) ?? b, 'ru');
    });
    return codes.map((code) => ({
      code,
      title: titles.get(code) ?? code,
      isPrimary: code === primary,
    }));
  });

  /** Первые три роли — то, что реально увидит клиент; остальные под «ещё N». */
  public readonly hiddenRolesCount = computed(() => Math.max(0, this.selectedList().length - 3));

  public setPrimary(code: string, ev: Event): void {
    ev.stopPropagation();
    this.primarySet.emit(code);
  }
}
