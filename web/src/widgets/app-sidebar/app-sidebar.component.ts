import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Category } from '@entities/category/model/category.types';
import { groupCategoriesByType } from '@shared/lib/category-groups';
import { withFromPage } from '@shared/nav/from-page';
import { NzIconModule } from 'ng-zorro-antd/icon';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NzIconModule],
  templateUrl: './app-sidebar.component.html',
  styleUrl: './app-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppSidebarComponent {
  public readonly categories = input<Category[]>([]);

  public readonly categoryGroups = computed(() => groupCategoriesByType(this.categories()));

  private readonly router = inject(Router);

  public goCategory(code: string, ev: MouseEvent): void {
    ev.preventDefault();
    void this.router.navigate(['/search'], withFromPage(this.router, { queryParams: { category: code } }));
  }
}
