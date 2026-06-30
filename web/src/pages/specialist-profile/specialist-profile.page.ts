import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BackLinkComponent } from '@shared/nav/back-link.component';
import { DatePipe } from '@angular/common';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import { PortfolioImage, SpecialistProfile } from '@entities/specialist/model/specialist.types';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category } from '@entities/category/model/category.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { PortfolioGridComponent } from '@widgets/portfolio-grid/portfolio-grid.component';
import { PortfolioPlayerOverlayComponent } from '@widgets/portfolio-player-overlay/portfolio-player-overlay.component';
import { PhotoLightboxComponent } from '@widgets/photo-lightbox/photo-lightbox.component';
import { ProfileAsideComponent } from '@widgets/profile-aside/profile-aside.component';
import { formatRate } from '@shared/lib/format';
import { socialLinkURL, SocialKey } from '@shared/lib/social-links';
import { RateStarsComponent } from '@widgets/rate-stars/rate-stars.component';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

@Component({
  selector: 'app-specialist-profile-page',
  standalone: true,
  imports: [
    BackLinkComponent,
    DatePipe,
    NzAvatarModule,
    NzButtonModule,
    NzIconModule,
    NzTagModule,
    NzSpinModule,
    AppHeaderComponent,
    PortfolioGridComponent,
    PortfolioPlayerOverlayComponent,
    PhotoLightboxComponent,
    ProfileAsideComponent,
    RateStarsComponent,
  ],
  templateUrl: './specialist-profile.page.html',
  styleUrl: './specialist-profile.page.scss',
})
export class SpecialistProfilePage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly specialistApi = inject(SpecialistApi);

  private readonly cart = inject(ProjectCartStore);

  public readonly profile = signal<SpecialistProfile | null>(null);

  public readonly loading = signal(true);

  public readonly categories = signal<Category[]>([]);

  /** Открыт ли fullscreen-плеер портфолио (на тачах после тапа по тайлу). */
  public readonly playerOpen = signal(false);

  /** Открытый photo-set для lightbox'а. null = закрыт. */
  public readonly lightboxImages = signal<PortfolioImage[] | null>(null);
  public readonly lightboxTitle = signal<string>('');

  /** Развёрнут ли полный bio (по умолчанию clamp до 3 строк на тачах). */
  public readonly bioExpanded = signal(false);

  public readonly formatRate = formatRate;

  // Map<category_code, title> для portfolio-grid — чтобы плашка-чип на
  // плитке показывала читаемое имя категории, а не код.
  public readonly categoryTitlesMap = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of this.profile()?.categories ?? []) {
      out[c.code] = c.title;
    }
    return out;
  });

  // Primary direct-contact CTA: первая заполненная соцсеть из приоритетного
  // порядка. Telegram > WhatsApp > VK > Website. Если ни одной — null,
  // и фронт показывает только корзинную кнопку (existing flow).
  public readonly primaryDirectContact = computed<
    { key: SocialKey; label: string; icon: string; url: string } | null
  >(() => {
    const s = this.profile()?.social_links;
    if (!s) return null;
    const priority: Array<{ key: SocialKey; label: string; icon: string }> = [
      { key: 'telegram', label: 'Telegram', icon: '✈️' },
      { key: 'whatsapp', label: 'WhatsApp', icon: '💬' },
      { key: 'vk', label: 'ВКонтакте', icon: '🌐' },
      { key: 'website', label: 'сайте', icon: '🔗' },
    ];
    for (const p of priority) {
      const raw = (s as Record<string, string | undefined>)[p.key];
      if (raw) {
        const url = socialLinkURL(p.key, raw);
        if (url) return { ...p, url };
      }
    }
    return null;
  });

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
        });
    });
  }

  public primaryRole(p: SpecialistProfile): string {
    const primary = p.categories?.find((c) => c.is_primary);
    return primary?.title ?? p.categories?.[0]?.title ?? 'Специалист';
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

  public openPlayer(): void {
    this.playerOpen.set(true);
  }

  public closePlayer(): void {
    this.playerOpen.set(false);
  }

  public openPhotoSet(idx: number): void {
    const item = this.profile()?.portfolio?.[idx];
    if (!item || item.kind !== 'image' || !item.images?.length) return;
    this.lightboxImages.set(item.images);
    this.lightboxTitle.set(item.title || '');
  }

  public closeLightbox(): void {
    this.lightboxImages.set(null);
  }

  public toggleBio(): void {
    this.bioExpanded.update((v) => !v);
  }
}
