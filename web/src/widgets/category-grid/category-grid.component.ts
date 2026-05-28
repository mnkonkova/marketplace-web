import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Category } from '@entities/category/model/category.types';
import { CATEGORY_ICONS, tileTitle } from '@shared/lib/category-groups';
import { pluralCategories, pluralSpecialists } from '@shared/lib/format';

@Component({
  selector: 'app-category-grid',
  standalone: true,
  templateUrl: './category-grid.component.html',
  styleUrl: './category-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryGridComponent {
  public readonly title = input('');

  public readonly kicker = input('');
  /** Якорь для scrollIntoView с хедера (например production, promotion). */
  public readonly sectionId = input<string | undefined>(undefined);

  public readonly categories = input<Category[]>([]);

  public readonly counts = input<Record<string, number>>({});

  public readonly categoryClick = output<Category>();

  public readonly seeAllClick = output<void>();

  public icon(code: string): string {
    return CATEGORY_ICONS[code] ?? '·';
  }

  public displayTitle(cat: Category): string {
    return tileTitle(cat);
  }

  public categoriesLabel(): string {
    const n = this.categories().length;
    return `${n} ${pluralCategories(n)}`;
  }

  public countLabel(code: string): string {
    const n = this.counts()[code] ?? 0;
    return n > 0 ? pluralSpecialists(n) : 'пока никого';
  }
}
