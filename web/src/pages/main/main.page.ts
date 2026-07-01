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
import { feedVideoAnimatedThumbSrc, feedVideoPreviewSrc } from '@entities/feed/lib/preview';
import { ProgressiveVideoDirective } from '@shared/video/progressive-video.directive';
import { groupCategoriesByType } from '@shared/lib/category-groups';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { CategoryGridComponent } from '@widgets/category-grid/category-grid.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';
import { pluralSpecialists } from '@shared/lib/format';
import { isHomeSectionAnchor, scrollToAnchorWhenReady } from '@shared/lib/scroll-to-anchor';
import { withFromPage } from '@shared/nav/from-page';
import { specialistHandle } from '@shared/lib/specialist-link';
import { createTypewriter } from '@shared/lib/typewriter.signal';
import { SEARCH_PLACEHOLDER_EXAMPLES, PLACEHOLDER_TIMING } from '@shared/lib/search-placeholders';
import { InviteBannerComponent } from '@widgets/invite-banner/invite-banner.component';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';

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
    ProgressiveVideoDirective,
    InviteBannerComponent,
  ],
  templateUrl: './main.page.html',
  styleUrl: './main.page.scss',
})
export class MainPage implements OnInit {
  private readonly categoryApi = inject(CategoryApi);

  private readonly feedApi = inject(FeedApi);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  // Typewriter в placeholder'е — ротирующиеся примеры «что искать».
  // На prefers-reduced-motion — статичная первая фраза.
  public readonly placeholder = createTypewriter({
    phrases: SEARCH_PLACEHOLDER_EXAMPLES,
    ...PLACEHOLDER_TIMING,
  });

  // Условие показа invite-banner: только неавторизованным. Signal reactive
  // (AuthSessionStore.isLoggedIn — computed от session().access_token).
  private readonly auth = inject(AuthSessionStore);
  public readonly isLoggedIn = this.auth.isLoggedIn;

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

  /**
   * Источник animated WebP «гифки» для главной. Возвращает '' если
   * воркер ещё не сгенерил webp — шаблон тогда фолбэчит на <video>.
   * <img animated webp> играет даже в iOS Low Power Mode (где <video>
   * autoplay блокируется), и не упирается в лимит ~4 одновременных
   * <video> на странице. См. backend docs/VIDEO_TRANSCODING.md §11.
   */
  public readonly animatedThumbSrc = feedVideoAnimatedThumbSrc;

  /**
   * Гарантированный старт после canplay — autoplay-атрибут не всегда
   * триггерится когда src задаётся через Angular signal (особенно для
   * .mov / video/quicktime). Стреляет столько раз, сколько надо.
   */
  public forcePlay(ev: Event): void {
    const v = ev.target as HTMLVideoElement;
    // Принудительно муем даже если атрибут muted уже стоит — Chrome
    // иногда теряет muted-state при пересоздании элемента / смене src.
    v.muted = true;
    v.volume = 0;
    if (v.paused) {
      v.play().catch(() => {
        /* autoplay-policy / network — без шума */
      });
    }
  }

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

  public openSpecialist(spec: { user_id: string; username?: string }, ev: MouseEvent): void {
    ev.preventDefault();
    void this.router.navigate(['/specialist', specialistHandle(spec)], withFromPage(this.router));
  }

  public submitSearch(): void {
    const q = this.query.trim();
    if (!q) return;
    this.query = '';
    // v2.1: главная → сразу /search (LLM-diaлог /clarify убран из воронки,
    // /search/summarize остаётся под капотом как опциональный re-rank).
    this.router.navigate(['/search'], withFromPage(this.router, { queryParams: { q } }));
  }

  public openCategory(cat: Category): void {
    this.router.navigate(
      ['/search'],
      withFromPage(this.router, { queryParams: { category: cat.code } }),
    );
  }

  public seeAll(): void {
    // «Смотреть всех» → тикток-лента /feed. Отфильтрованный список
    // (карточки + фильтры) остался на /search — туда ведут категории.
    this.router.navigate(['/feed'], withFromPage(this.router));
  }

  public totalLabel(): string {
    return pluralSpecialists(this.totalCount());
  }
}
