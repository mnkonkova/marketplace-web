import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { DatePipe } from '@angular/common';
import { BackLinkComponent } from '@shared/nav/back-link.component';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import { PortfolioItem, SpecialistProfile } from '@entities/specialist/model/specialist.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { PortfolioFlagshipComponent } from '@widgets/portfolio-flagship/portfolio-flagship.component';
import { PortfolioGridComponent } from '@widgets/portfolio-grid/portfolio-grid.component';
import { PortfolioPlayerOverlayComponent } from '@widgets/portfolio-player-overlay/portfolio-player-overlay.component';
import { ProfileAsideComponent } from '@widgets/profile-aside/profile-aside.component';
import { RateStarsComponent } from '@widgets/rate-stars/rate-stars.component';
import { RichBioComponent } from '@shared/ui/rich-bio/rich-bio.component';
import { copyToClipboard } from '@shared/lib/clipboard';
import { posterSrc } from '@shared/lib/portfolio-media';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

/** Сколько ролей показываем до клика по «ещё N». */
const VISIBLE_ROLES = 3;

@Component({
  selector: 'app-specialist-profile-page',
  standalone: true,
  imports: [
    BackLinkComponent,
    DatePipe,
    NzAvatarModule,
    NzButtonModule,
    NzEmptyModule,
    NzIconModule,
    NzSkeletonModule,
    AppHeaderComponent,
    PortfolioFlagshipComponent,
    PortfolioGridComponent,
    PortfolioPlayerOverlayComponent,
    ProfileAsideComponent,
    RateStarsComponent,
    RichBioComponent,
  ],
  templateUrl: './specialist-profile.page.html',
  styleUrl: './specialist-profile.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecialistProfilePage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly specialistApi = inject(SpecialistApi);

  private readonly cart = inject(ProjectCartStore);

  private readonly meta = inject(Meta);

  private readonly title = inject(Title);

  private readonly msg = inject(NzMessageService);

  public readonly profile = signal<SpecialistProfile | null>(null);

  public readonly loading = signal(true);

  /** Развёрнут ли полный список ролей. */
  public readonly rolesExpanded = signal(false);

  /**
   * id работы, с которой открыт полноэкранный плеер. null = плеер закрыт.
   *
   * Плеер — существующий прод-компонент (portfolio-player-overlay поверх
   * feed-view): полноэкранный оверлей, свайп/стрелки, наложенное инфо,
   * «В проект», счётчик, переключатель звука. Свою модалку под это не
   * делаем — она была бы хуже и увела бы два плеера в расхождение.
   */
  public readonly playerItemId = signal<string | null>(null);

  public readonly categoryTitlesMap = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of this.profile()?.categories ?? []) {
      out[c.code] = c.title;
    }
    return out;
  });

  /**
   * Закреплённая работа. Если специалист промо не выбрал — null, и блок
   * флагмана не рендерится вовсе (первую попавшуюся работу за промо не
   * выдаём: это был бы не его выбор).
   */
  public readonly featured = computed<PortfolioItem | null>(
    () => this.profile()?.portfolio?.find((p) => p.is_featured) ?? null,
  );

  /** Лента — всё, кроме флагмана: он уже показан крупно сверху. */
  public readonly feedItems = computed<PortfolioItem[]>(() => {
    const all = this.profile()?.portfolio ?? [];
    const featured = this.featured();
    return featured ? all.filter((p) => p.id !== featured.id) : all;
  });

  public readonly worksCount = computed(() => this.profile()?.portfolio?.length ?? 0);

  public readonly visibleRoles = computed(() => this.allRoles().slice(0, VISIBLE_ROLES));

  public readonly hiddenRolesCount = computed(() =>
    Math.max(0, this.allRoles().length - VISIBLE_ROLES),
  );

  public readonly allRoles = computed<string[]>(() => {
    const cats = this.profile()?.categories ?? [];
    const primary = cats.find((c) => c.is_primary) ?? cats[0];
    if (!primary) return [];
    return [primary.title, ...cats.filter((c) => c !== primary).map((c) => c.title)];
  });

  public readonly rolesToShow = computed(() =>
    this.rolesExpanded() ? this.allRoles() : this.visibleRoles(),
  );

  /** Публичный адрес страницы: красивый handle, если специалист его выбрал. */
  public readonly shareUrl = computed(() => {
    const p = this.profile();
    if (!p || typeof window === 'undefined') return '';
    return `${window.location.origin}/specialist/${p.username || p.user_id}`;
  });

  /** Обложка для предпросмотра ссылки и og:image. */
  public readonly shareCover = computed(() => {
    const p = this.profile();
    if (!p) return '';
    const featured = this.featured();
    if (featured && posterSrc(featured)) return posterSrc(featured);
    const firstWithPoster = p.portfolio?.find((item) => posterSrc(item));
    return firstWithPoster ? posterSrc(firstWithPoster) : p.avatar_url || '';
  });

  public readonly shareRoles = computed(() => this.visibleRoles().join(', ').toLowerCase());

  public ngOnInit(): void {
    this.route.paramMap.subscribe((pm) => {
      const id = pm.get('id');
      if (!id) return;
      this.loading.set(true);
      this.specialistApi
        .getById(id)
        .pipe(
          catchError(() => EMPTY),
          finalize(() => this.loading.set(false)),
        )
        .subscribe((p) => {
          this.profile.set(p);
          this.applyShareMeta(p);
        });
    });
  }

  public inCart(): boolean {
    const id = this.profile()?.user_id;
    return id ? this.cart.has(id) : false;
  }

  public toggleProject(): void {
    const p = this.profile();
    if (!p) return;
    this.cart.toggle({
      user_id: p.user_id,
      display_name: p.display_name,
      city: p.city,
      rate_min: p.rate_min,
      rate_max: p.rate_max,
      currency: p.currency,
      categories: p.categories?.map((c) => c.code),
    });
  }

  public toggleRoles(): void {
    this.rolesExpanded.update((v) => !v);
  }

  /**
   * «Поделиться» в шапке — то же действие, что и в карточке-визитке сбоку:
   * системный share-лист на мобиле, копирование ссылки на десктопе.
   */
  public share(): void {
    const url = this.shareUrl();
    if (!url) return;
    const p = this.profile();
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      navigator
        .share({ title: p?.display_name ?? 'Портфолио', text: 'Портфолио на wayprmarket', url })
        .catch(() => {});
      return;
    }
    if (copyToClipboard(url)) {
      this.msg.success('Ссылка скопирована');
    } else {
      this.msg.error('Не удалось скопировать — выделите ссылку вручную');
    }
  }

  public openFlagship(): void {
    const featured = this.featured();
    if (featured) this.playerItemId.set(featured.id);
  }

  public openFromFeed(feedIndex: number): void {
    const item = this.feedItems()[feedIndex];
    if (item) this.playerItemId.set(item.id);
  }

  public closePlayer(): void {
    this.playerItemId.set(null);
  }

  /**
   * OG/Twitter-мета для разворота ссылки в мессенджерах.
   *
   * TODO(backend/SSR): этого недостаточно. Telegram/WhatsApp/VK не исполняют
   * JS — они читают HTML, который отдал сервер, а Caddy отдаёт общий
   * index.html со статической мета-информацией сайта. Чтобы ссылка на
   * конкретного специалиста разворачивалась его карточкой, мету должен
   * рендерить сервер: SSR (@angular/ssr) либо ветка в Caddy, отправляющая
   * запросы ботов на эндпоинт API, который вернёт HTML-заглушку с og:*.
   * Код ниже нужен для корректного title во вкладке и для тех клиентов,
   * которые всё-таки исполняют JS.
   */
  private applyShareMeta(p: SpecialistProfile): void {
    const roles = (p.categories ?? [])
      .slice(0, VISIBLE_ROLES)
      .map((c) => c.title)
      .join(', ');
    const pageTitle = roles ? `${p.display_name} — ${roles}` : p.display_name;
    const where = p.city || (p.is_freelance ? 'Фриланс' : '');
    const description = [where, p.production_name, `${p.portfolio?.length ?? 0} работ в портфолио`]
      .filter(Boolean)
      .join(' · ');

    this.title.setTitle(`${pageTitle} · wayprmarket`);
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: 'profile' });
    this.meta.updateTag({ name: 'description', content: description });
    const cover = this.shareCover();
    if (cover) {
      this.meta.updateTag({ property: 'og:image', content: cover });
      this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
      this.meta.updateTag({ name: 'twitter:image', content: cover });
    }
    const url = this.shareUrl();
    if (url) this.meta.updateTag({ property: 'og:url', content: url });
  }
}
