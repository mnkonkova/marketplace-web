import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category } from '@entities/category/model/category.types';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import { ClarifyMessage, ClarifySearchParams } from '@entities/specialist/model/specialist.types';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

@Component({
  selector: 'app-clarify-page',
  standalone: true,
  imports: [FormsModule, NzButtonModule, NzInputModule, NzSpinModule, AppHeaderComponent],
  templateUrl: './clarify.page.html',
  styleUrl: './clarify.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClarifyPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly categoryApi = inject(CategoryApi);

  private readonly specialistApi = inject(SpecialistApi);

  public readonly messages = signal<ClarifyMessage[]>([]);

  public readonly loading = signal(false);

  public readonly category = signal<Category | null>(null);

  public readonly pendingSearch = signal<ClarifySearchParams | null>(null);

  public readonly error = signal('');

  public input = '';

  private categoryCode = '';

  private autoSent = false;

  public ngOnInit(): void {
    this.route.queryParamMap.subscribe((qp) => {
      this.categoryCode = qp.get('category') ?? '';
      const initialText = (qp.get('q') ?? '').trim();
      this.resolveCategory();
      if (!this.autoSent) {
        this.autoSent = true;
        if (initialText) {
          this.send(initialText);
        } else {
          this.appendAssistant(this.initialAssistantText());
        }
      }
    });
  }

  public title(): string {
    return this.category() ? `Уточняем: ${this.category()!.title}` : 'Свободный поиск';
  }

  public submit(): void {
    const text = this.input.trim();
    if (!text || this.loading()) return;
    this.send(text);
  }

  public runSearch(): void {
    const p = this.pendingSearch();
    if (!p) return;
    this.router.navigate(['/search'], { queryParams: this.toQueryParams(p) });
  }

  private send(text: string): void {
    this.input = '';
    this.error.set('');
    this.pendingSearch.set(null);
    const nextHistory: ClarifyMessage[] = [...this.messages(), { role: 'user', content: text }];
    this.messages.set(nextHistory);
    this.loading.set(true);
    this.specialistApi
      .clarify(this.categoryCode, nextHistory)
      .pipe(
        catchError((err) => {
          const apiError = err?.error?.error;
          const message =
            apiError === 'llm_disabled'
              ? 'Уточнение временно недоступно — можно сразу запустить поиск по вашему запросу.'
              : `Не получилось уточнить: ${apiError || err.message || 'ошибка'}. Можно запустить поиск без уточнения.`;
          this.error.set(message);
          this.messages.update((items) => [...items, { role: 'assistant', content: message }]);
          this.pendingSearch.set(this.normalizeSearch({ q: text }, text));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe((res) => {
        const assistantText = res.message || 'Принял задачу.';
        this.messages.update((items) => [...items, { role: 'assistant', content: assistantText }]);
        if (res.done && res.search) {
          this.pendingSearch.set(this.normalizeSearch(res.search, text));
        }
      });
  }

  private normalizeSearch(search: ClarifySearchParams, fallbackText: string): ClarifySearchParams {
    return {
      q: search.q || fallbackText,
      categories: search.categories?.length
        ? search.categories
        : this.categoryCode
          ? [this.categoryCode]
          : [],
      skills: search.skills ?? [],
      city: search.city ?? '',
      rate_min: search.rate_min,
      rate_max: search.rate_max,
    };
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

  private resolveCategory(): void {
    if (!this.categoryCode) {
      this.category.set(null);
      return;
    }
    this.categoryApi.list().subscribe((cats) => {
      this.category.set(cats.find((c) => c.code === this.categoryCode) ?? null);
    });
  }

  private initialAssistantText(): string {
    const cat = this.category();
    if (cat) {
      return `Задача в категории «${cat.title}». В двух словах: для какой платформы и какой формат? Можно сразу указать бюджет и сроки.`;
    }
    return 'Опишите задачу одной фразой: например, «нужен монтажёр для Reels по фитнесу, бюджет до 30 000».';
  }

  private appendAssistant(content: string): void {
    this.messages.update((items) => [...items, { role: 'assistant', content }]);
  }
}
