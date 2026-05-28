import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { FeedViewComponent } from '@widgets/feed-view/feed-view.component';
import { FeedParams } from '@entities/feed/model/feed.types';
import { CategoryApi } from '@entities/category/api/category.api';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import {
  ClarifySearchParams,
  SearchHit,
  SearchParams,
  SpecialistLite,
  SummarizePick,
} from '@entities/specialist/model/specialist.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { formatRate } from '@shared/lib/format';
import { RateStarsComponent } from '@widgets/rate-stars/rate-stars.component';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

@Component({
  selector: 'app-feed-page',
  standalone: true,
  imports: [
    DecimalPipe,
    RouterLink,
    NzButtonModule,
    AppHeaderComponent,
    FeedViewComponent,
    RateStarsComponent,
  ],
  templateUrl: './feed.page.html',
  styleUrl: './feed.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly categoryApi = inject(CategoryApi);

  private readonly specialistApi = inject(SpecialistApi);

  private readonly cart = inject(ProjectCartStore);

  public readonly params = signal<FeedParams>({});

  public readonly title = signal('Лента');

  public readonly feedKey = signal(0);

  public readonly mode = signal<'feed' | 'ai' | 'list'>('feed');

  public readonly loading = signal(false);

  public readonly summary = signal('');

  public readonly picks = signal<SummarizePick[]>([]);

  public readonly list = signal<SearchHit[]>([]);

  public readonly similar = signal<SearchHit[]>([]);

  public readonly total = signal(0);

  private categoryTitles = new Map<string, string>();

  private currentSearch: ClarifySearchParams = {};

  public ngOnInit(): void {
    this.categoryApi.list().subscribe((cats) => {
      this.categoryTitles = new Map(cats.map((c) => [c.code, c.title]));
    });

    this.route.queryParamMap.subscribe((qp) => {
      const categories = qp.getAll('category');
      const skills = qp.getAll('skill');
      const q = qp.get('q') ?? undefined;
      const city = qp.get('city') ?? undefined;
      const rateMin = qp.get('rate_min') ? Number(qp.get('rate_min')) : undefined;
      const rateMax = qp.get('rate_max') ? Number(qp.get('rate_max')) : undefined;
      const ids = qp
        .getAll('ids')
        .flatMap((v) => v.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
      const next: ClarifySearchParams = {
        q,
        categories: categories.length ? categories : undefined,
        skills: skills.length ? skills : undefined,
        city,
        rate_min: Number.isFinite(rateMin) ? rateMin : undefined,
        rate_max: Number.isFinite(rateMax) ? rateMax : undefined,
      };
      this.currentSearch = next;
      this.params.set({ ...next, ids: ids.length ? ids : undefined });
      this.resolveTitle(categories, q, ids.length > 0);
      if (ids.length) {
        this.mode.set('feed');
        this.feedKey.update((k) => k + 1);
      } else if (q?.trim()) {
        this.runAiSearch(next);
      } else {
        this.mode.set('feed');
        this.feedKey.update((k) => k + 1);
      }
    });
  }

  public goProfile(spec: SpecialistLite): void {
    this.router.navigate(['/specialist', spec.user_id]);
  }

  public readonly formatRate = formatRate;

  public categoryTitle(code: string): string {
    return this.categoryTitles.get(code) ?? code;
  }

  public inCart(id: string): boolean {
    return this.cart.has(id);
  }

  public toggleCart(spec: SpecialistLite, ev: Event): void {
    ev.stopPropagation();
    this.cart.toggle(spec);
  }

  public backToClarify(): void {
    this.router.navigate(['/clarify'], { queryParams: this.toQueryParams(this.currentSearch) });
  }

  public showAllMatches(): void {
    this.runListSearch(this.currentSearch, 'Все совпадения по запросу');
  }

  public viewWorks(): void {
    const ids = this.picks()
      .map((p) => p.user_id)
      .filter(Boolean);
    if (!ids.length) return;
    this.router.navigate(['/search'], { queryParams: { ids: ids.join(',') } });
  }

  private runAiSearch(params: ClarifySearchParams): void {
    this.mode.set('ai');
    this.loading.set(true);
    this.summary.set('Подбираем для вас…');
    this.picks.set([]);
    this.list.set([]);
    this.similar.set([]);
    const targetCategory = params.categories?.length === 1 ? params.categories[0] : '';

    this.specialistApi
      .summarize(params, targetCategory)
      .pipe(
        catchError(() => {
          this.runListSearch(params, 'AI-подбор временно недоступен — показываем обычный поиск.');
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe((res) => {
        const picks = res.picks ?? [];
        if (picks.length) {
          this.mode.set('ai');
          this.summary.set(res.summary || 'Мы выбрали специалистов под ваш запрос.');
          this.picks.set(picks);
          this.total.set(res.total_in_category ?? picks.length);
          return;
        }
        this.runListSearch(params, 'Ничего точного не нашли — показываем все совпадения.');
      });
  }

  private runListSearch(params: ClarifySearchParams, note: string): void {
    this.mode.set('list');
    this.loading.set(true);
    this.summary.set('Загружаем каталог…');
    this.picks.set([]);
    const searchParams: SearchParams = { ...params, limit: 50, offset: 0 };

    this.specialistApi
      .search(searchParams)
      .pipe(
        catchError(() => {
          this.summary.set('Поиск временно недоступен.');
          this.list.set([]);
          this.similar.set([]);
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe((res) => {
        this.list.set(res.items ?? []);
        this.similar.set(res.similar ?? []);
        this.total.set(res.total ?? res.items?.length ?? 0);
        this.summary.set(
          this.total() > 0
            ? `Найдено ${this.total()}. Добавляйте подходящих в проект — отправите бриф всем разом.`
            : 'Никого не нашлось. Попробуйте смягчить запрос.',
        );
      });
  }

  private toQueryParams(search: ClarifySearchParams): Record<string, string | string[] | number> {
    const out: Record<string, string | string[] | number> = {};
    if (search.q) out['q'] = search.q;
    if (search.categories?.length) out['category'] = search.categories;
    if (search.skills?.length) out['skill'] = search.skills;
    if (search.city) out['city'] = search.city;
    if (search.rate_min != null) out['rate_min'] = search.rate_min;
    if (search.rate_max != null) out['rate_max'] = search.rate_max;
    return out;
  }

  private resolveTitle(categories: string[], q?: string, hasIds = false): void {
    if (hasIds) {
      this.title.set('Подобранные специалисты');
      return;
    }
    if (q) {
      this.title.set('Подбор по запросу');
      return;
    }
    if (categories.length === 1) {
      this.categoryApi.list().subscribe((cats) => {
        const cat = cats.find((c) => c.code === categories[0]);
        this.title.set(cat?.title ?? 'Лента');
      });
      return;
    }
    this.title.set(categories.length ? 'Лента' : 'Все специалисты');
  }
}
