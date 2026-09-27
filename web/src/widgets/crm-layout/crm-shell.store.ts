import { Injectable, TemplateRef, signal } from '@angular/core';

/** Ссылка в хлебных крошках. Без link — текущая страница, её не кликают. */
export interface CrmCrumb {
  label: string;
  link?: string;
}

/**
 * Чем страница дополняет CRM-оболочку.
 *
 * Раньше страница оборачивала себя в лейаут сама и клала крошки и меню
 * «⋯» прямо в него через ng-content. Теперь оболочка стоит на
 * родительском маршруте, а внутри у неё router-outlet — контент туда не
 * спроецируешь. Поэтому страница передаёт сюда шаблон действий и хвост
 * крошек, а оболочка их рисует.
 *
 * Хвост, а не весь путь: «Админка / Работа / Проекты» оболочка знает
 * сама — это её же дерево разделов (см. crmNavLocate). Страница добавляет
 * только то, чего в дереве нет: название открытой карточки.
 *
 * Очистку берёт на себя оболочка (по ActivationStart), а не страница:
 * иначе каждый экран обязан был бы помнить про ngOnDestroy ради шапки,
 * которой у него чаще всего и нет.
 */
@Injectable({ providedIn: 'root' })
export class CrmShellStore {
  /** Крошки за разделом: обычно одна — название открытой карточки. */
  public readonly trail = signal<CrmCrumb[]>([]);

  /** Шаблон действий страницы — рисуется в полосе крошек справа. */
  public readonly actions = signal<TemplateRef<unknown> | null>(null);

  /**
   * Сколько заявок ждёт в менеджерских «Входящих».
   *
   * Оболочка живёт дольше страницы и сама этот список не грузит: его уже
   * просит страница входящих, и второй такой же запрос при каждом заходе
   * в CRM — плата за цифру, которую и так посчитали.
   */
  public readonly inboxCount = signal<number | null>(null);

  public setTrail(trail: CrmCrumb[]): void {
    this.trail.set(trail);
  }

  public setActions(tpl: TemplateRef<unknown> | null): void {
    this.actions.set(tpl);
  }

  public setInboxCount(n: number): void {
    this.inboxCount.set(n);
  }

  /** Сбрасывается то, что принадлежит странице. Счётчики — не её. */
  public reset(): void {
    this.trail.set([]);
    this.actions.set(null);
  }
}
