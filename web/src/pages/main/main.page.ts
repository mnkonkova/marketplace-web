import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category } from '@entities/category/model/category.types';
import { FeedApi } from '@entities/feed/api/feed.api';
import { FeedItem } from '@entities/feed/model/feed.types';
import { feedVideoPreviewSrc } from '@entities/feed/lib/preview';
import { groupCategoriesByType, HERO_QUICK_TAGS } from '@shared/lib/category-groups';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { CategoryGridComponent } from '@widgets/category-grid/category-grid.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';
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
    SupportFooterComponent,
  ],
  templateUrl: './main.page.html',
  styleUrl: './main.page.scss',
})
export class MainPage implements OnInit {
  private readonly categoryApi = inject(CategoryApi);

  private readonly feedApi = inject(FeedApi);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  public readonly quickTags = HERO_QUICK_TAGS;

  public readonly howSteps = [
    {
      n: 1,
      title: 'Опишите задачу',
      text: 'ИИ уточнит детали — стиль, бюджет, сроки. Без брифа на пять страниц.',
    },
    {
      n: 2,
      title: 'Получите подборку',
      text: 'Список верифицированных специалистов под ваш контекст — за минуту.',
    },
    {
      n: 3,
      title: 'Запустите проект',
      text: 'Связь напрямую, общий канбан, прозрачные правки — без потерянных задач.',
    },
  ];

  public query = '';

  public readonly categories = signal<Category[]>([]);

  public readonly categoryGroups = computed(() => groupCategoriesByType(this.categories()));

  public readonly counts = signal<Record<string, number>>({});

  public readonly totalCount = signal(0);

  /** 3-4 видео из общей ленты — фон hero. Auto-play, muted, loop. */
  public readonly heroVideos = signal<FeedItem[]>([]);

  /** 8 работ для секции «Смотрите, что снимают» — autoplay muted на всех. */
  public readonly featuredWorks = signal<FeedItem[]>([]);

  /**
   * Источник src для autoplay-карточек hero и featured. preview_url если
   * воркер уже сгенерил облегчённое видео, иначе — полный url
   * (см. backend docs/VIDEO_TRANSCODING.md). Используется из шаблона.
   */
  public readonly previewSrc = feedVideoPreviewSrc;

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
    this.feedApi.load({}).subscribe((res) => {
      const items = res.items ?? [];
      this.heroVideos.set(items.slice(0, 4));
      this.featuredWorks.set(items.slice(4, 12));
    });
  }

  public categoryTitle(code: string): string {
    return this.categories().find((c) => c.code === code)?.title ?? code;
  }

  public openSpecialist(id: string, ev: MouseEvent): void {
    ev.preventDefault();
    void this.router.navigate(['/specialist', id], withFromPage(this.router));
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
