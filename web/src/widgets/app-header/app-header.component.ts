import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AuthDialogComponent } from '@features/auth/ui/auth.dialog';
import { openClientRegister } from '@features/client-register/open-client-register';
import { ProjectCartDialogComponent, ProjectCartStore } from '@features/project-cart';
import { scrollToAnchorWhenReady } from '@shared/lib/scroll-to-anchor';

type NavItem =
  | 'home'
  | 'production'
  | 'promotion'
  | 'search'
  | 'cabinet'
  | 'creator-projects'
  | 'manager'
  | 'admin';
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

  private readonly destroyRef = inject(DestroyRef);

  public readonly isLoggedIn = this.auth.isLoggedIn;

  public readonly cartCount = this.cart.count;

  // CRM v5: показываем разные пункты по role. Пока role не подгружена,
  // считаем что это базовый юзер (показываем «Кабинет» как раньше).
  // Роли не исключают друг друга: менеджер бывает и креатором, клиент —
  // специалистом. Поэтому пункты шапки считаются по НАЛИЧИЮ роли, а не
  // по одной derived-строке: иначе менеджер-креатор видел только CRM, а
  // свои выкладки открыть было неоткуда.
  public readonly showManagerCabinet = computed(() => this.auth.roles().includes('manager'));

  public readonly showAdminCabinet = computed(() => this.auth.roles().includes('admin'));

  public readonly showSpecialistCabinet = computed(() => {
    const r = this.auth.roles();
    return r.includes('specialist') || !r.length;
  });

  /**
   * Ссылка «Мои проекты» у креатора.
   *
   * Страница есть, а попасть на неё было неоткуда: «Кабинет» у специалиста
   * ведёт на /me — портфолио и ставки, — и проекты оставались доступны
   * только по прямому адресу.
   */
  public readonly showCreatorProjects = computed(() => this.auth.roles().includes('specialist'));

  // CTA «Создать проект» — это корзина витрины: набрал специалистов,
  // нажал, оформил заказ. Специалисту она не нужна — он сам себе клиент в
  // этой кнопке не нуждается. Персоналу тоже: у менеджера на канбане своя
  // кнопка «+ Создать проект», которая заводит проект в CRM, и две разные
  // кнопки с одной подписью на одном экране означали разное. Для гостя и
  // клиента кнопка остаётся и на десктопе, и на мобайле (см. CSS: на
  // мобайле прячутся только .link-текстовые пункты, кнопки .cta остаются
  // справа от бургера).
  public readonly showCreateProjectCTA = computed(() => {
    const r = this.auth.role();
    return r !== 'specialist' && r !== 'manager' && r !== 'admin';
  });

  // Куда ведёт «Кабинет» в зависимости от роли:
  // - specialist     → /me (портфолио, ставки, контакты — рабочее место);
  // - client         → /me/projects (его проекты — 99% активности);
  // - manager, admin → /me/projects (контакты заполняются в карточках проектов,
  //                    специалистский /me им не нужен).
  /**
   * Куда ведёт «Кабинет».
   *
   * У специалиста это его карточка — портфолио и ставки; у остальных —
   * портфель проектов заказчика. Специалист проверяется первым: у
   * менеджера-креатора есть и то и другое, но «Кабинет» для него — своя
   * карточка, а чужие проекты открываются пунктом «Менеджер».
   */
  public readonly cabinetLink = computed(() => {
    const roles = this.auth.roles();
    if (!roles.length) return '/me'; // сессия ещё грузится
    return roles.includes('specialist') ? '/me' : '/me/projects';
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
    this.openAuthIfAsked();
    // Шапка живёт внутри layout'ов, а те пересоздаются на каждом
    // переходе: без отписки подписки копятся вместе с мёртвыми копиями
    // компонента.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
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

  /**
   * Открыть окно входа, если об этом попросили адресом (`?auth=login`).
   *
   * Отдельной страницы входа у нас нет — вход живёт окном на главной.
   * Но ссылку «войдите вот тут» приходится давать: из мини-аппа
   * Telegram, из письма, из бота. Без этого человек попадает на
   * витрину и ищет кнопку глазами, а половина не находит.
   *
   * Параметр из адреса убираем сразу: иначе окно всплывёт снова при
   * возврате назад по истории.
   */
  private openAuthIfAsked(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') !== 'login') return;
    if (this.auth.isLoggedIn()) return;
    params.delete('auth');
    const rest = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash,
    );
    this.openAuth(0);
  }

  public openAuth(initialTab: 0 | 1 = 0): void {
    this.modal.create({
      nzContent: AuthDialogComponent,
      nzFooter: null,
      nzWidth: 'min(420px, 92vw)',
      nzData: { initialTab },
    });
  }

  /** Регистрация — через мастер: он же спрашивает роль и собирает профиль. */
  public goRegister(): void {
    void this.router.navigate(['/start']);
  }

  public goRegisterFromMenu(): void {
    this.closeMenu();
    this.goRegister();
  }

  public openProject(): void {
    // Незарегистрированному корзина бесполезна: заявку некому привязать.
    // Заказчику показываем окно регистрации, а не мастер — мастер про сбор
    // профиля, которого у заказчика нет.
    if (!this.isLoggedIn()) {
      openClientRegister(this.modal).afterClose.subscribe((ok) => {
        if (ok) this.openProject();
      });
      return;
    }
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

    // Рабочие кабинеты. Шапка про них не знала вовсе: «Админ» и
    // «Менеджер» не подсвечивались никогда, и пункт выглядел неактивной
    // ссылкой, даже когда ты в нём и стоишь.
    //
    // Внутри самой CRM шапки нет — она там не нужна, — но карточка
    // проекта у менеджера открывается по /manager/..., и путь сюда
    // приходит с любого экрана, где шапка есть: во время перехода
    // подсветка не должна мигать на «Главную».
    if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
    if (path === '/manager' || path.startsWith('/manager/')) return 'manager';
    // Проекты креатора — свой пункт: он стоит рядом с «Кабинетом», и
    // подсвечивать вместо него кабинет значило бы врать, где ты.
    if (path.startsWith('/me/creator')) return 'creator-projects';
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
