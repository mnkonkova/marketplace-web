import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BackLinkComponent } from '@shared/nav/back-link.component';
import { DatePipe } from '@angular/common';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import { SpecialistProfile } from '@entities/specialist/model/specialist.types';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category } from '@entities/category/model/category.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { PortfolioGridComponent } from '@widgets/portfolio-grid/portfolio-grid.component';
import { PortfolioPlayerOverlayComponent } from '@widgets/portfolio-player-overlay/portfolio-player-overlay.component';
import { ProfileAsideComponent } from '@widgets/profile-aside/profile-aside.component';
import { formatRate } from '@shared/lib/format';
import { RateStarsComponent } from '@widgets/rate-stars/rate-stars.component';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

@Component({
  selector: 'app-specialist-profile-page',
  standalone: true,
  imports: [
    BackLinkComponent,
    RouterLink,
    DatePipe,
    NzAvatarModule,
    NzButtonModule,
    NzTagModule,
    NzSpinModule,
    AppHeaderComponent,
    PortfolioGridComponent,
    PortfolioPlayerOverlayComponent,
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

  /** Развёрнут ли полный bio (по умолчанию clamp до 3 строк на тачах). */
  public readonly bioExpanded = signal(false);

  public readonly formatRate = formatRate;

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

  public toggleBio(): void {
    this.bioExpanded.update((v) => !v);
  }
}
