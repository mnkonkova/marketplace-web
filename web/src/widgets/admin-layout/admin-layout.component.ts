import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AdminApi } from '@entities/admin/api/admin.api';

/** Ссылка в хлебных крошках. Без link — текущая страница, её не кликают. */
export interface AdminCrumb {
  label: string;
  link?: string;
}

interface NavItem {
  label: string;
  link: string;
  /** Префиксы URL, на которых пункт считается активным, кроме самого link. */
  also?: string[];
  /** Активен только на точном совпадении: /manager — это «Заявки», а не всё под ним. */
  exact?: boolean;
  /** Счётчик ждущих у пункта. Пока такой один — модерация. */
  counter?: 'moderation';
}

/**
 * Оболочка админки.
 *
 * Была горизонтальной полосой поверх витринной шапки, и на входе в проект
 * набиралось пять уровней навигации подряд: шапка маркетплейса, полоса
 * разделов, тулбар страницы, вкладки проекта и боковая колонка менеджера.
 * До первой строки содержимого уходила треть экрана, а два «Выйти» на
 * одном экране (иконка в шапке и красная кнопка в полосе) не давали
 * понять, что из них выход из аккаунта, а что — из админки.
 *
 * Поэтому: собственный вертикальный сайдбар без витринной шапки, разделы
 * сгруппированы по смыслу (ежедневные очереди, справочники, люди), выход
 * из аккаунта один и лежит в блоке пользователя, а уход на витрину — это
 * отдельная ссылка, не выход.
 *
 * Селектор и путь остались прежними (app-admin-layout): его знают
 * двенадцать страниц, и переименование ради названия стоило бы двенадцати
 * правок в чужих файлах.
 */
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent implements OnInit {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly adminApi = inject(AdminApi);

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Крошки страницы. Пустые — полосы сверху нет вовсе: у разделов админки
   * свой h1, и крошка «Проекты» над заголовком «Проекты» была бы вторым
   * названием той же страницы.
   */
  public readonly crumbs = input<AdminCrumb[]>([]);

  /**
   * Страница менеджерская, а смотрит её админ. Действия на ней пишутся от
   * имени того, кто нажал, и без пометки это выясняется уже по логу.
   */
  public readonly viewingAsManager = input(false);

  public readonly userName = computed(() => this.auth.displayName());

  public readonly userInitial = computed(() =>
    (this.auth.displayName().trim().charAt(0) || '·').toUpperCase(),
  );

  // Счётчик заявок на модерации. Считается один раз на маунт: у каждой
  // админской страницы своя копия оболочки, и переход между разделами и
  // так пересоздаёт компонент. Отдельная подписка на NavigationEnd здесь
  // была не второй свежестью, а второй бедой: она жила дольше компонента,
  // копилась с каждым переходом, и один переход слал столько запросов,
  // сколько переходов было до него, — рейт-лимитер отвечал 429 на всю
  // админку.
  public readonly pendingModeration = signal(0);

  /** Открыт ли off-canvas сайдбар. На широком экране он всегда на месте. */
  public readonly navOpen = signal(false);

  /** Текущий URL — по нему подсвечивается активный пункт. */
  private readonly url = signal('');

  public readonly groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Работа',
      items: [
        // Карточка проекта живёт по менеджерскому адресу, но для админа
        // это тот же раздел «Проекты» — иначе, открыв проект, он теряет,
        // где находится.
        { label: 'Проекты', link: '/admin/projects', also: ['/manager/projects'] },
        { label: 'Модерация', link: '/admin/moderation', counter: 'moderation' },
        { label: 'Заявки', link: '/manager', exact: true },
      ],
    },
    {
      title: 'Справочники',
      items: [
        { label: 'Продакшены', link: '/admin/productions' },
        { label: 'Воронки', link: '/admin/pipelines' },
        { label: 'Прайс', link: '/admin/tariff' },
        { label: 'Чеклисты', link: '/admin/checklists' },
      ],
    },
    {
      title: 'Люди',
      items: [
        { label: 'Менеджеры', link: '/admin/managers' },
        { label: 'Пользователи', link: '/admin/users' },
      ],
    },
  ];

  public ngOnInit(): void {
    this.url.set(this.router.url);
    this.refreshPending();
    // Подписка нужна одному: закрыть шторку после перехода и переподсветить
    // пункт. takeUntilDestroyed — чтобы она умерла вместе с копией оболочки.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        this.navOpen.set(false);
      });
  }

  public isActive(item: NavItem): boolean {
    const url = this.url().split('?')[0];
    if (item.exact) return url === item.link;
    return [item.link, ...(item.also ?? [])].some((p) => url === p || url.startsWith(`${p}/`));
  }

  public counterOf(item: NavItem): number {
    return item.counter === 'moderation' ? this.pendingModeration() : 0;
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
    this.adminApi.pendingModerationCount().subscribe({
      next: (r) => this.pendingModeration.set(r.pending_count),
      // 401/403 — прав нет; бейдж просто не появится.
      error: () => this.pendingModeration.set(0),
    });
  }
}
