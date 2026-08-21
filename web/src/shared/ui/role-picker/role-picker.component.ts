import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Category } from '@entities/category/model/category.types';
import { CategoryTypeGroup } from '@shared/lib/category-groups';

/**
 * Выбор ролей специалиста: карточки по группам, одна главная.
 *
 * Общий для кабинета (вкладка «Навыки») и мастера регистрации — данные там
 * одни и те же, и копировать разметку с логикой «главная роль ровно одна»
 * в два места означало бы чинить каждую правку дважды.
 *
 * Компонент без состояния: что выбрано и что главное, решает владелец.
 */
@Component({
  selector: 'app-role-picker',
  standalone: true,
  templateUrl: './role-picker.component.html',
  styleUrl: './role-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolePickerComponent {
  public readonly categoryGroups = input<CategoryTypeGroup[]>([]);

  public readonly categories = input<Category[]>([]);

  public readonly selectedCategories = input<Set<string>>(new Set());

  public readonly primaryCategory = input<string>('');

  public readonly toggled = output<string>();

  public readonly primarySet = output<string>();

  /** Название главной роли для строки-итога под сеткой. */
  public readonly primaryTitle = computed(() => {
    const primary = this.primaryCategory();
    if (!primary || !this.selectedCategories().has(primary)) return '';
    return this.categories().find((c) => c.code === primary)?.title ?? '';
  });

  /**
   * Публичная страница показывает три первые роли и «ещё N». Когда ролей
   * больше, специализация перестаёт читаться — предупреждаем мягко, без
   * жёсткого лимита.
   */
  public readonly hiddenRolesCount = computed(() =>
    Math.max(0, this.selectedCategories().size - 3),
  );

  public onSetPrimary(code: string, ev: Event): void {
    ev.stopPropagation();
    this.primarySet.emit(code);
  }
}
