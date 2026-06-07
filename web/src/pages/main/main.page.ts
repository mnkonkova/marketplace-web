import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category } from '@entities/category/model/category.types';
import { groupCategoriesByType, HERO_QUICK_TAGS } from '@shared/lib/category-groups';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { CategoryGridComponent } from '@widgets/category-grid/category-grid.component';
import { pluralSpecialists } from '@shared/lib/format';
import { isHomeSectionAnchor, scrollToAnchorWhenReady } from '@shared/lib/scroll-to-anchor';
import { withFromPage } from '@shared/nav/from-page';

@Component({
  selector: 'app-main-page',
  standalone: true,
  imports: [
    FormsModule,
    NzButtonModule,
    NzInputModule,
    NzIconModule,
    AppHeaderComponent,
    CategoryGridComponent,
  ],
  templateUrl: './main.page.html',
  styleUrl: './main.page.scss',
})
export class MainPage implements OnInit {
  private readonly categoryApi = inject(CategoryApi);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  public readonly quickTags = HERO_QUICK_TAGS;

  public query = '';

  public readonly categories = signal<Category[]>([]);

  public readonly categoryGroups = computed(() => groupCategoriesByType(this.categories()));

  public readonly counts = signal<Record<string, number>>({});

  public readonly totalCount = signal(0);

  public ngOnInit(): void {
    this.route.fragment.subscribe((fragment) => {
      if (fragment && isHomeSectionAnchor(fragment)) {
        scrollToAnchorWhenReady(fragment);
      }
    });

    this.categoryApi.list().subscribe((items) => {
      this.categories.set(items);
      const fragment = this.route.snapshot.fragment;
      if (fragment && isHomeSectionAnchor(fragment)) {
        scrollToAnchorWhenReady(fragment);
      }
    });
    this.categoryApi.stats().subscribe((stats) => {
      this.counts.set(stats);
      this.totalCount.set(Object.values(stats).reduce((a, b) => a + b, 0));
    });
  }

  public search(): void {
    const q = this.query.trim();
    if (!q) return;
    this.query = '';
    this.router.navigate(['/clarify'], withFromPage(this.router, { queryParams: { q } }));
  }

  public openCategory(cat: Category): void {
    this.router.navigate(
      ['/search'],
      withFromPage(this.router, { queryParams: { category: cat.code } }),
    );
  }

  public seeAll(): void {
    this.router.navigate(['/search'], withFromPage(this.router));
  }

  public openQuick(tag: string): void {
    this.query = tag;
  }

  public totalLabel(): string {
    return pluralSpecialists(this.totalCount());
  }
}
