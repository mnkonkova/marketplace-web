import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';

/** Пункт полосы разделов под шапкой: подпись и адрес. */
export interface SotkaNavItem {
  title: string;
  link: string;
  /** Открыт сейчас. Считает страница: у неё есть адрес, у полосы — нет. */
  current?: boolean;
}

/**
 * Верхняя полоса кабинетов «Сотки» — перенос шапки из макета.
 *
 * Без названия площадки слева: кабинет открывают по ссылке из бота или
 * из письма и работают в нём, а не «заходят на сайт». Место в шапке
 * дороже отдать тому, что меняется, — проекту, периоду, имени.
 *
 * Своя, а не app-header: тот живёт на тёмной теме всего остального
 * сайта и устроен как навигация витрины — «Поиск», «Создать проект»,
 * корзина. Здесь другая работа: сказать, в каком проекте человек и в
 * какой роли, и показать, сколько от периода прошло. Общее у них ровно
 * «выйти», и ради него одного тащить в кабинет второе меню незачем.
 *
 * Роль тут НЕ переключатель, как в макете: в макете один человек
 * показывает три кабинета, в жизни у каждого своя роль. Поэтому справа
 * стоят только те кабинеты, которые этому человеку действительно
 * открыты, — и переход между ними это переход по адресу, а не
 * перерисовка макета.
 */
@Component({
  selector: 'app-sotka-top',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sotka-top.component.html',
  styleUrl: './sotka-top.component.scss',
})
export class SotkaTopComponent {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  /** Название того, что открыто: проект, «все проекты», раздел CRM. */
  public readonly title = input('');

  /** Вторая строка: состав, площадки, чей проект. */
  public readonly subtitle = input('');

  /** Разделы текущего кабинета. Пусто — полосы нет вовсе. */
  public readonly nav = input<readonly SotkaNavItem[]>([]);

  /**
   * Период проекта: подпись и доля пройденного.
   *
   * Показываем только то, что посчитал сервер. Доли нет — полосы нет:
   * нарисованная «на глаз» шкала пройденного здесь врёт человеку про
   * его же счёт.
   */
  public readonly periodLabel = input('');

  public readonly periodDay = input('');

  /** 0..100. Отрицательное и пустое считаем «неизвестно». */
  public readonly periodPercent = input<number | null>(null);

  /**
   * Показывать ли имя и «Выйти».
   *
   * В кабинете заказчика над полосой стоит шапка сайта, и «Выйти» в ней
   * уже есть. Две одинаковые кнопки в семидесяти пикселях друг от друга
   * человек жмёт наугад, а потом проверяет, из чего именно он вышел.
   */
  public readonly showWho = input(true);

  public readonly userName = computed(() => this.auth.displayName() || 'Вы');

  public readonly barWidth = computed(() => {
    const p = this.periodPercent();
    if (p === null || p === undefined || p < 0) return null;
    return Math.max(0, Math.min(100, p));
  });

  public logout(): void {
    this.auth.clear();
    void this.router.navigateByUrl('/');
  }
}
