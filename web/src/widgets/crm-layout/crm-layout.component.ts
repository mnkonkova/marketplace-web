import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivationStart,
  Event as RouterEvent,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AdminApi } from '@entities/admin/api/admin.api';

import { CrmIconComponent } from './crm-icon.component';
import {
  CrmNavGroup,
  CrmNavItem,
  CrmRole,
  crmNavGroups,
  crmNavItemActive,
  crmNavLocate,
  crmRootLabel,
} from './crm-nav';
import { CrmCrumb, CrmShellStore } from './crm-shell.store';

/** Ширина, ниже которой сайдбар уезжает в шторку. */
const NARROW = '(max-width: 1000px)';

/**
 * Оболочка CRM — одна на админа и менеджера.
 *
 * До этого их было две: `admin-layout` с вертикальным сайдбаром и
 * `manager-layout` с горизонтальными вкладками поверх витринной шапки.
 * Разметка у них расходилась, хотя работа одна и та же: те же проекты, те
 * же карточки, тот же выход. Стоило это двух правок на каждую — и одного
 * экрана, на котором менеджер и админ видели один проект по-разному.
 *
 * Что зависит от роли — только состав сайдбара (см. crm-nav). Всё
 * остальное — полоса крошек, пометка режима, ширина содержимого —
 * одинаково, потому что одинаково и то, ради чего сюда заходят.
 *
 * Оболочка стоит на родительском маршруте, а не внутри страниц: страница,
 * знающая, во что она обёрнута, обязана помнить об этом при каждом
 * переезде, и половина админских экранов уже жила с чужой оболочкой.
 */
@Component({
  selector: 'app-crm-layout',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, RouterOutlet, CrmIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './crm-layout.component.html',
  styleUrl: './crm-layout.component.scss',
})
export class CrmLayoutComponent implements OnInit {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly adminApi = inject(AdminApi);

  private readonly destroyRef = inject(DestroyRef);

  private readonly shell = inject(CrmShellStore);

  /** Текущий URL — по нему подсвечивается активный пункт и строятся крошки. */
  private readonly url = signal('');

  /** Роль решает только состав сайдбара; всё прочее у ролей общее. */
  public readonly role = computed<CrmRole>(() =>
    this.auth.role() === 'admin' ? 'admin' : 'manager',
  );

  public readonly groups = computed<CrmNavGroup[]>(() => crmNavGroups(this.role()));

  public readonly brandName = computed(() => crmRootLabel(this.role()));

  public readonly homeLink = computed(() => (this.role() === 'admin' ? '/admin' : '/manager'));

  /** Подпись под именем: чей это экран и что он видит. */
  public readonly roleNote = computed(() =>
    this.role() === 'admin' ? 'Админ · видит всё' : 'Менеджер',
  );

  public readonly actions = this.shell.actions;

  public readonly userName = computed(() => this.auth.displayName());

  public readonly userInitial = computed(() =>
    (this.auth.displayName().trim().charAt(0) || '·').toUpperCase(),
  );

  /**
   * Путь: корень, группа, раздел и хвост от страницы. Собирается из того
   * же дерева, что рисует сайдбар, — иначе крошки и меню разошлись бы при
   * первом же переименовании раздела.
   */
  public readonly crumbs = computed<CrmCrumb[]>(() => {
    const role = this.role();
    const here = crmNavLocate(role, this.url());
    if (!here) return [{ label: crmRootLabel(role) }, ...this.shell.trail()];
    const trail = this.shell.trail();
    const out: CrmCrumb[] = [{ label: crmRootLabel(role) }];
    // У «Сводки» и «Входящих» среднего звена нет: группа называется так
    // же, как работа в ней, и «Работа / Сводка» читалось бы как повтор.
    if (!here.item.exact) out.push({ label: here.group.title });
    // Раздел кликабелен, только когда за ним что-то есть, — иначе это
    // ссылка на страницу, на которой ты стоишь.
    out.push(
      trail.length ? { label: here.item.label, link: here.item.link } : { label: here.item.label },
    );
    return [...out, ...trail];
  });

  /**
   * Админ на менеджерской странице. Раньше это был вход-параметр, и его
   * приходилось не забыть проставить на каждом таком экране; на деле это
   * вычисляется из роли и адреса — и ошибиться там негде.
   */
  public readonly viewingAsManager = computed(
    () => this.role() === 'admin' && this.url().startsWith('/manager'),
  );

  // Счётчик заявок на модерации. Считается один раз на маунт: оболочка
  // теперь живёт на родительском маршруте, и переходы между разделами её
  // не пересоздают. Подписка на каждый переход была бы запросом на каждый
  // клик — рейт-лимитер отвечал на такое 429 по всей админке.
  public readonly pendingModeration = signal(0);

  /** Открыта ли шторка. На широком экране сайдбар всегда на месте. */
  public readonly navOpen = signal(false);

  /** Узкий экран: сайдбар уехал и открывается кнопкой. */
  public readonly narrow = signal(false);

  /** Шторка закрыта и не должна ловить фокус табом. */
  public readonly navHidden = computed(() => this.narrow() && !this.navOpen());

  public constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mql = window.matchMedia(NARROW);
      this.narrow.set(mql.matches);
      const onChange = (e: MediaQueryListEvent): void => {
        this.narrow.set(e.matches);
        // Расширили окно — сайдбар и так на месте, «открытость» больше
        // ничего не значит и мешала бы обратно при сужении.
        if (!e.matches) this.navOpen.set(false);
      };
      mql.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => mql.removeEventListener('change', onChange));
    }
  }

  public ngOnInit(): void {
    this.url.set(this.router.url);
    this.refreshPending();
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e: RouterEvent) => {
      // ActivationStart приходит до создания компонента страницы: шапку
      // чистим здесь, чтобы новая страница успела положить свою в ngOnInit.
      if (e instanceof ActivationStart) this.shell.reset();
      if (e instanceof NavigationEnd) {
        this.url.set(e.urlAfterRedirects);
        this.navOpen.set(false);
      }
    });
  }

  /** Escape закрывает шторку — иначе её нечем закрыть с клавиатуры. */
  @HostListener('document:keydown.escape')
  public onEscape(): void {
    if (this.navOpen()) this.navOpen.set(false);
  }

  public isActive(item: CrmNavItem): boolean {
    return crmNavItemActive(item, this.url());
  }

  /** Коралловый бейдж очереди. 0 и «не знаем» бейджа не рисуют. */
  public badgeOf(item: CrmNavItem): number | null {
    const n =
      item.counter === 'moderation'
        ? this.pendingModeration()
        : item.counter === 'inbox'
          ? (this.shell.inboxCount() ?? 0)
          : 0;
    return n > 0 ? n : null;
  }

  public toggleNav(): void {
    this.navOpen.set(!this.navOpen());
  }

  public closeNav(): void {
    this.navOpen.set(false);
  }

  public logout(): void {
    this.auth.clear();
    void this.router.navigateByUrl('/');
  }

  private refreshPending(): void {
    // Бейдж модерации — админский; менеджеру эта ручка отвечает 403.
    if (this.role() !== 'admin') return;
    this.adminApi.pendingModerationCount().subscribe({
      next: (r) => this.pendingModeration.set(r.pending_count),
      // 401/403 — прав нет; бейдж просто не появится.
      error: () => this.pendingModeration.set(0),
    });
  }
}
