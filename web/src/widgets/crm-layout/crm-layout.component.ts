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
import { AdminSummaryStore } from '@entities/admin/model/admin-summary.store';
import { CrmIconComponent } from '@shared/ui/crm-icon/crm-icon.component';
import { CrmSearchComponent } from '@widgets/crm-search/crm-search.component';
import { CrmSearchStore } from '@widgets/crm-search/crm-search.store';

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
  imports: [NgTemplateOutlet, RouterLink, RouterOutlet, CrmIconComponent, CrmSearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './crm-layout.component.html',
  styleUrl: './crm-layout.component.scss',
})
export class CrmLayoutComponent implements OnInit {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly summary = inject(AdminSummaryStore);

  private readonly search = inject(CrmSearchStore);

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

  /**
   * Счётчики разделов. Приезжают вместе со сводкой одним запросом: цифра
   * у пункта обязана равняться числу строк, которые откроются по клику, а
   * считать их по восьми разным ручкам — восемь поводов разойтись.
   *
   * Запрос один на весь заход в CRM: оболочка живёт на родительском
   * маршруте и переходами между разделами не пересоздаётся.
   */
  public readonly navCounts = computed(() => this.summary.data()?.nav_counts ?? null);

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
    // Сводку просит и экран /admin — хранилище отдаёт им один ответ.
    if (this.role() === 'admin') this.summary.ensure();
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

  /**
   * Коралловый бейдж очереди — только там, где ждут нас: модерация и
   * входящие. Ноль и «ещё не знаем» бейджа не рисуют: пустой кружок
   * читается как «ноль чего-то важного», хотя важного там нет.
   */
  public badgeOf(item: CrmNavItem): number | null {
    if (item.counter !== 'moderation' && item.counter !== 'inbox') return null;
    const n =
      item.counter === 'moderation'
        ? // Только nav_counts: старая ручка счётчика модерации не
          // исключает тестовых пользователей, и её число расходилось бы с
          // очередью, которая по клику откроется.
          (this.navCounts()?.moderation_pending ?? 0)
        : (this.shell.inboxCount() ?? 0);
    return n > 0 ? n : null;
  }

  /** Приглушённый счётчик: сколько всего в разделе. */
  public countOf(item: CrmNavItem): number | null {
    const c = item.counter;
    if (!c || c === 'moderation' || c === 'inbox') return null;
    const counts = this.navCounts();
    return counts ? counts[c] : null;
  }

  public openSearch(ev: Event): void {
    this.search.show(ev.currentTarget);
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
}
