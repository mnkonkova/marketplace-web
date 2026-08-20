import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AuthDialogComponent } from '@features/auth/ui/auth.dialog';
import { ProjectCartDialogComponent, ProjectCartStore } from '@features/project-cart';
import { scrollToAnchorWhenReady } from '@shared/lib/scroll-to-anchor';

type NavItem = 'home' | 'production' | 'promotion' | 'search' | 'cabinet' | 'manager' | 'admin';
type HomeSection = 'production' | 'promotion';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, NzButtonModule, NzBadgeModule, NzIconModule],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppHeaderComponent implements OnInit {
  private readonly auth = inject(AuthSessionStore);

  private readonly cart = inject(ProjectCartStore);

  private readonly modal = inject(NzModalService);

  private readonly router = inject(Router);

  public readonly isLoggedIn = this.auth.isLoggedIn;

  public readonly cartCount = this.cart.count;

  // CRM v5: показываем разные пункты по role. Пока role не подгружена,
  // считаем что это базовый юзер (показываем «Кабинет» как раньше).
  public readonly showManagerCabinet = computed(() => this.auth.role() === 'manager');

  public readonly showAdminCabinet = computed(() => this.auth.role() === 'admin');

  public readonly showSpecialistCabinet = computed(() => {
    const r = this.auth.role();
    return r === 'specialist' || r === '';
  });

  // CTA «Создать проект» прячем только у специалиста — он сам себе клиент
  // в этой кнопке не нуждается, путает интерфейс. Для гостя/клиента/менеджера/
  // админа кнопка остаётся в шапке и на десктопе, и на мобайле (см. CSS:
  // на мобайле прячутся только .link-текстовые пункты, кнопки .cta —
  // и «Создать проект», и «Я специалист» — остаются справа от бургера).
  public readonly showCreateProjectCTA = computed(() => this.auth.role() !== 'specialist');

  // Куда ведёт «Кабинет» в зависимости от роли:
  // - specialist     → /me (портфолио, ставки, контакты — рабочее место);
  // - client         → /me/projects (его проекты — 99% активности);
  // - manager, admin → /me/projects (контакты заполняются в карточках проектов,
  //                    специалистский /me им не нужен).
  public readonly cabinetLink = computed(() => {
    const role = this.auth.role();
    if (role === 'client' || role === 'manager' || role === 'admin') return '/me/projects';
    return '/me'; // specialist (и '' пока сессия грузится — fallback на cabinet)
  });

  // logout — очищает токены и редиректит на главную. Вызывается из шапки.
  public logout(): void {
    this.auth.clear();
    void this.router.navigateByUrl('/');
  }

  /** Выход из мобильного меню: сначала закрыть шторку, потом уходить. */
  public logoutFromMenu(): void {
    this.closeMenu();
    this.logout();
  }

  public readonly menuOpen = signal(false);

  public readonly activeNav = signal<NavItem | null>(null);

  public ngOnInit(): void {
    this.syncActiveNavFromUrl();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.syncActiveNavFromUrl());
  }

  public toggleMenu(): void {
    this.setMenuOpen(!this.menuOpen());
  }

  public closeMenu(): void {
    this.setMenuOpen(false);
  }

  public onHomeClick(ev: Event): void {
    ev.preventDefault();
    this.goHome();
  }

  public goHome(): void {
    this.closeMenu();
    if (this.currentPath() === '/' && !this.currentHash()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.syncActiveNavFromUrl();
      return;
    }
    void this.router.navigateByUrl('/').then((ok) => {
      if (ok) window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  public openAuth(initialTab: 0 | 1 = 0): void {
    this.modal.create({
      nzContent: AuthDialogComponent,
      nzFooter: null,
      nzWidth: 'min(420px, 92vw)',
      nzData: { initialTab },
    });
  }

  public openProject(): void {
    this.modal.create({
      nzContent: ProjectCartDialogComponent,
      nzFooter: null,
      nzWidth: 540,
      nzClassName: 'project-modal',
      nzCentered: true,
    });
  }

  // Из шторки: сначала закрываем меню, потом открываем модалку. Иначе
  // backdrop меню остаётся, перекрывая модалку (видно как «не нажимается»).
  public openAuthFromMenu(initialTab: 0 | 1 = 0): void {
    this.closeMenu();
    this.openAuth(initialTab);
  }

  public openProduction(): void {
    this.closeMenu();
    void this.openHomeSection('production');
  }

  public openPromotion(): void {
    this.closeMenu();
    void this.openHomeSection('promotion');
  }

  private setMenuOpen(open: boolean): void {
    this.menuOpen.set(open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  private syncActiveNavFromUrl(): void {
    this.activeNav.set(this.navFromUrl());
  }

  private navFromUrl(): NavItem | null {
    const path = this.currentPath();
    const hash = this.currentHash();

    // /me и /me/projects подсвечиваем одним пунктом «Кабинет» — фронт
    // подбирает URL по роли, но визуально это всегда один таб в шапке.
    if (path === '/me' || path.startsWith('/me/projects')) return 'cabinet';
    // /clarify — legacy, redirect'ится на /search в routes. Оставляем в
    // match'е чтобы во время pending-redirect'а header не мигал.
    if (path === '/search' || path === '/clarify') return 'search';
    if (path === '/') {
      if (hash === 'production') return 'production';
      if (hash === 'promotion') return 'promotion';
      return 'home';
    }
    return null;
  }

  private openHomeSection(section: HomeSection): void {
    if (this.currentPath() === '/' && this.currentHash() === section) {
      this.syncActiveNavFromUrl();
      scrollToAnchorWhenReady(section);
      return;
    }

    void this.router.navigate(['/'], { fragment: section });
  }

  private currentPath(): string {
    return this.router.url.split('?')[0].split('#')[0];
  }

  private currentHash(): string {
    const hash = this.router.url.split('#')[1] ?? '';
    return hash.split('?')[0];
  }
}
