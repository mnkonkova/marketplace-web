import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { isTouchDevice } from '@shared/lib/touch';
import { OptionSheetComponent, SheetOption } from '@shared/ui/option-sheet/option-sheet.component';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import { SearchHit } from '@entities/specialist/model/specialist.types';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category, Skill } from '@entities/category/model/category.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { specialistHandle } from '@shared/lib/specialist-link';
import { withFromPage } from '@shared/nav/from-page';
import { createTypewriter } from '@shared/lib/typewriter.signal';
import { SEARCH_PLACEHOLDER_EXAMPLES, PLACEHOLDER_TIMING } from '@shared/lib/search-placeholders';

/**
 * SearchResultsPage — карточная сетка результатов поиска специалистов.
 * Заменяет старый TikTok-like feed-player на /search (см. v2.1 промпт).
 *
 * URL — источник истины: /search?q=...&category=csv&skill=csv[&ids=csv].
 * Дропдауны читают начальное состояние из URL, при изменении обновляют
 * URL (replaceUrl:true — не плодим history entries).
 *
 * Пагинация — button «Показать ещё» (никаких бесконечных скроллов).
 * Карточка — превью-видео (autoplay muted loop playsinline), под ним
 * имя + специальность + «В проект». Клик по карточке → /specialist/:handle,
 * клик по «В проект» — stopPropagation.
 */
@Component({
  selector: 'app-search-results-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzInputModule,
    NzSelectModule,
    NzIconModule,
    NzSpinModule,
    NzEmptyModule,
    AppHeaderComponent,
    OptionSheetComponent,
  ],
  templateUrl: './search-results.page.html',
  styleUrl: './search-results.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsPage implements OnInit {
  private readonly api = inject(SpecialistApi);
  private readonly categoryApi = inject(CategoryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cart = inject(ProjectCartStore);
  private readonly destroyRef = inject(DestroyRef);

  // Форма: q — signal, чтобы OnPush change detection пересчитывал
  // [ngModel]="q()" когда subscribe кладёт значение из URL. С plain
  // property'ем поле оставалось пустым после перехода с главной
  // (queryParam был, но [ngModel] не обновлялся).
  public readonly q = signal<string>('');
  public categories: string[] = [];
  public skills: string[] = [];
  // ids фильтр из ?ids=csv — legacy из feed.viewWorks (жёсткое ограничение
  // на конкретных спецов). Не рендерим UI управления, только читаем.
  private ids: string[] = [];

  // Данные справочников (для select-options)
  public readonly categoryOptions = signal<Category[]>([]);
  public readonly skillOptions = signal<Skill[]>([]);

  // Состояние выдачи
  public readonly items = signal<SearchHit[]>([]);
  public readonly total = signal<number>(0);
  public readonly loading = signal<boolean>(false);
  public readonly error = signal<string>('');

  // broadened — бэк не нашёл по тексту НИЧЕГО и вместо пустой выдачи вернул
  // всех подряд (см. search.Service: при 0 хитов и отсутствии фильтров q
  // выкидывается). Без явной плашки это читается как баг: на «монтажер»
  // первой карточкой шёл актёр, потому что порядок в такой выдаче
  // произвольный. Храним и сам запрос, который никуда не попал — q()
  // успевает измениться, пока юзер допечатывает следующий.
  public readonly broadened = signal<boolean>(false);
  public readonly broadenedQuery = signal<string>('');

  // Пагинация
  private readonly pageSize = 20;
  public readonly hasMore = computed(() => this.items().length < this.total());

  // Cart — определяем «В проекте» на кнопке
  public readonly cartSpecialists = this.cart.specialists;

  // Typewriter в sticky-search — тот же список фраз что на главной
  public readonly placeholder = createTypewriter({
    phrases: SEARCH_PLACEHOLDER_EXAMPLES,
    ...PLACEHOLDER_TIMING,
  });

  // Debounce для input'а — не сыплем запрос на каждую букву
  private readonly q$ = new Subject<string>();

  public ngOnInit(): void {
    // Читаем URL при загрузке и на back/forward navigation
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      this.q.set(p.get('q') ?? '');
      this.categories = csv(p.get('category'));
      this.skills = csv(p.get('skill'));
      this.ids = csv(p.get('ids'));
      this.reloadFirstPage();
    });

    // Debounce ручного ввода в поле — обновит URL, что дёрнет ngOnInit-subscribe.
    this.q$.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncUrl();
    });

    // Справочники — один раз при загрузке
    this.categoryApi.list().subscribe((items) => this.categoryOptions.set(items));
    this.categoryApi.skills().subscribe((items) => this.skillOptions.set(items));
  }

  public onQChange(v: string): void {
    this.q.set(v);
    this.q$.next(v);
  }

  public readonly isTouch = signal(isTouchDevice());

  public readonly catSheet = signal(false);

  public readonly skillSheet = signal(false);

  public readonly categorySheetOptions = computed<SheetOption[]>(() =>
    this.categoryOptions().map((c) => ({ value: c.code, label: c.title })),
  );

  public readonly skillSheetOptions = computed<SheetOption[]>(() =>
    this.skillOptions().map((sk) => ({ value: sk.slug, label: sk.title })),
  );

  /** Шторка отдаёт значение, накопление множественного выбора — на нас. */
  public toggleCategory(code: string): void {
    this.categories = this.categories.includes(code)
      ? this.categories.filter((c) => c !== code)
      : [...this.categories, code];
    this.onFiltersChange();
  }

  public toggleSkill(slug: string): void {
    this.skills = this.skills.includes(slug)
      ? this.skills.filter((sk) => sk !== slug)
      : [...this.skills, slug];
    this.onFiltersChange();
  }

  public onFiltersChange(): void {
    this.syncUrl();
  }

  // submitNow — instant поиск по клику на «Найти» или Enter в input'е.
  // Помимо syncUrl (обновит адрес) явно зовём reloadFirstPage — иначе
  // если URL не изменился (юзер клацнул «Найти» второй раз с тем же q),
  // queryParamMap subscribe не эмитит событие и запрос не улетает.
  public submitNow(): void {
    this.syncUrl();
    this.reloadFirstPage();
  }

  public showMore(): void {
    if (this.loading() || !this.hasMore()) return;
    this.loading.set(true);
    this.api
      .search({
        q: this.q() || undefined,
        categories: this.categories.length ? this.categories : undefined,
        skills: this.skills.length ? this.skills : undefined,
        limit: this.pageSize,
        offset: this.items().length,
      })
      .subscribe({
        next: (res) => {
          this.items.update((cur) => [...cur, ...res.items]);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Не удалось загрузить ещё. Попробуйте обновить страницу.');
          this.loading.set(false);
        },
      });
  }

  public goProfile(spec: SearchHit): void {
    void this.router.navigate(['/specialist', specialistHandle(spec)], withFromPage(this.router));
  }

  public toggleCart(spec: SearchHit, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.cart.toggle(spec);
  }

  public isInCart(userId: string): boolean {
    return this.cartSpecialists().some((s) => s.user_id === userId);
  }

  public categoryTitle(code: string): string {
    return this.categoryOptions().find((c) => c.code === code)?.title ?? code;
  }

  // headlineCategory — какую категорию писать на карточке как «главную».
  // Если юзер отфильтровал по конкретной категории и она у спеца есть —
  // показываем именно её (Анна с primary=smm при фильтре editor будет
  // показана как «Монтажёр» — иначе выглядело бы багом «SMM в editor
  // выдаче»). Без фильтра — старый primary_category.
  public headlineCategory(spec: SearchHit): string {
    const cats = spec.categories ?? [];
    const match = this.categories.find((c) => cats.includes(c));
    if (match) return match;
    return spec.primary_category || cats[0] || '';
  }

  // otherCategories — остальные категории спеца для inline-подписи серым.
  // Отсекаем ту что уже пошла в headline. Обрезаем до 3, чтобы карточка
  // не разбухала на спецах со спамом категорий.
  public otherCategories(spec: SearchHit): string[] {
    const cats = spec.categories ?? [];
    const headline = this.headlineCategory(spec);
    return cats.filter((c) => c && c !== headline).slice(0, 3);
  }

  public skillTitle(slug: string): string {
    return this.skillOptions().find((s) => s.slug === slug)?.title ?? slug;
  }

  public removeCategory(code: string): void {
    this.categories = this.categories.filter((c) => c !== code);
    this.syncUrl();
  }

  public removeSkill(slug: string): void {
    this.skills = this.skills.filter((s) => s !== slug);
    this.syncUrl();
  }

  // clearQuery — «показываете всех? тогда убери мой запрос из строки».
  // Фильтры не трогаем: их юзер выставлял осознанно, в отличие от текста,
  // который ни во что не попал.
  public clearQuery(): void {
    this.q.set('');
    this.syncUrl();
  }

  public clearAll(): void {
    this.categories = [];
    this.skills = [];
    this.q.set('');
    this.syncUrl();
  }

  private reloadFirstPage(): void {
    this.loading.set(true);
    this.error.set('');
    // Снимок запроса на момент отправки: пока летит ответ, юзер может уже
    // печатать следующий — в плашке должно стоять то, что реально искали.
    const asked = this.q().trim();
    this.api
      .search({
        q: this.q() || undefined,
        categories: this.categories.length ? this.categories : undefined,
        skills: this.skills.length ? this.skills : undefined,
        limit: this.pageSize,
        offset: 0,
      })
      .subscribe({
        next: (res) => {
          // ids-filter: если пришли конкретные user_id из /feed.viewWorks —
          // фильтруем на клиенте (бэк /search не принимает ids). Redundant
          // работа, но проще чем менять API. См. промпт §3.7.
          let items = res.items;
          if (this.ids.length) {
            const idSet = new Set(this.ids);
            items = items.filter((s) => idSet.has(s.user_id));
          }
          this.items.set(items);
          this.total.set(this.ids.length ? items.length : res.total);
          // ids-режим показывает конкретных спецов — плашка про «ничего не
          // нашли по тексту» там не к месту.
          const broadened = !!res.broadened && !this.ids.length && !!asked;
          this.broadened.set(broadened);
          this.broadenedQuery.set(broadened ? asked : '');
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Не удалось загрузить результаты. Попробуйте позже.');
          this.broadened.set(false);
          this.loading.set(false);
        },
      });
  }

  private syncUrl(): void {
    // При изменении фильтров ids-локбок больше не нужен — юзер выбрал
    // новую комбинацию, значит явно расширяет выборку. Обнуляем.
    this.ids = [];
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: this.q().trim() || null,
        category: this.categories.length ? this.categories.join(',') : null,
        skill: this.skills.length ? this.skills.join(',') : null,
        ids: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
