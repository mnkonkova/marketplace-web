import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { CreatorDocument, CreatorProject } from '@entities/publication/model/publication.types';
import { MATERIAL_KIND_LABEL } from '@entities/publication/lib/materials';
import { daysLeft } from '@entities/publication/lib/publication-status';
import { plural } from '@shared/lib/format';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { parseApiError } from '@shared/api/api-error';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import {
  PrMarketNavItem,
  PrMarketTopComponent,
} from '@widgets/prmarket-top/prmarket-top.component';

// «Мои проекты» креатора: проекты, где он в действующем составе, со
// счётчиками только по своим выкладкам. До этой ручки на страницу выкладок
// можно было попасть лишь по ссылке из карточек «Назначенные проекты» — а
// там перечислены назначения по воронке, и креатор без такого назначения
// свой проект не находил вовсе.
//
// Карточки одного проекта (название, период, менеджер) у креатора в API
// по-прежнему нет: заголовок и статус здесь — всё, что отдаёт список.
@Component({
  selector: 'app-creator-projects-page',
  standalone: true,
  imports: [CommonModule, RouterLink, AppHeaderComponent, PrMarketTopComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-projects.page.html',
  styleUrl: './creator-projects.page.scss',
})
export class CreatorProjectsPage {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  private readonly auth = inject(AuthSessionStore);

  public readonly loading = signal(true);

  public readonly items = signal<CreatorProject[]>([]);

  /**
   * Мои документы: договоры по всем проектам.
   *
   * Отдельно от материалов проекта, и не случайно. Материалы отвечают
   * на вопрос «как снимать» и живут в карточке проекта, рядом с
   * чек-листом. Документ отвечает на другой вопрос — «на каких
   * условиях я работаю», — и человек ищет его не в момент съёмки, а
   * когда подписывает, выставляет счёт или спорит. Помнить, в каком
   * из восьми проектов лежал договор, он при этом не обязан.
   */
  public readonly docs = signal<CreatorDocument[]>([]);

  public readonly kindLabel = MATERIAL_KIND_LABEL;

  public constructor() {
    this.api.creatorProjects().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить проекты.').message);
      },
    });
    // Молча при отказе: документы — не то, ради чего человек открыл
    // кабинет, и красная плашка поверх списка проектов сообщала бы о
    // поломке там, где её не видно.
    this.api.creatorDocuments().subscribe({
      next: (r) => this.docs.set(r.items),
      error: () => this.docs.set([]),
    });
  }

  // Сначала те, где горит, потом по ближайшему сроку. Проект без
  // несданного уходит вниз: там смотреть нечего.
  public readonly ordered = computed(() =>
    [...this.items()].sort((a, b) => {
      if (!!b.publications_overdue !== !!a.publications_overdue) {
        return b.publications_overdue - a.publications_overdue;
      }
      const ad = a.next_due_date ?? '9999';
      const bd = b.next_due_date ?? '9999';
      return ad.localeCompare(bd) || a.title.localeCompare(b.title);
    }),
  );

  public readonly totalOverdue = computed(() =>
    this.items().reduce((s, p) => s + p.publications_overdue, 0),
  );

  /** Вторая строка шапки: из скольких проектов состоит работа. */
  public readonly subtitle = computed(() => {
    const n = this.items().length;
    if (!n) return '';
    return `${n} ${plural(n, 'проект', 'проекта', 'проектов')} в работе`;
  });

  /** Полоса разделов кабинета: в списке открыт он сам. */
  public readonly nav = computed<readonly PrMarketNavItem[]>(() => [
    { title: 'Мои проекты', link: '/me/creator/projects', current: true },
    // Заявки — соседний раздел того же кабинета: рассылка приходит в
    // бот, но ответить на неё надо здесь, и найти это место человек
    // должен без ссылки из сообщения.
    { title: 'Заявки', link: '/me/creator/invitations' },
    // «Веду» — для тех, кто ещё и менеджер. Один человек с двумя
    // шляпами: здесь его собственные съёмки, там — проекты, которые
    // он ведёт. В мини-аппе это единственный способ перейти между
    // ними: шапки сайта там нет.
    ...(this.auth.hasRole('manager')
      ? [{ title: 'Веду', link: '/manager/projects' } as PrMarketNavItem]
      : []),
  ]);

  /**
   * Срок ближайшей выкладки предложением.
   *
   * Общий dueLabel даёт «−4 дня» — подпись для колонки таблицы, где знак
   * и есть сообщение. В строке списка это читается как опечатка, и
   * просрочку приходится доосмысливать; здесь она названа словом.
   */
  public dueLine(p: CreatorProject): string {
    if (!p.next_due_date) {
      // Не «план выполнен» — это уже сказано плашкой у названия. Здесь
      // отвечаем на следующий вопрос: а когда будет что делать.
      return p.publications_total ? 'новые даты поставит менеджер' : 'дат выкладок пока нет';
    }
    const d = daysLeft(p.next_due_date);
    if (d === 0) return 'сегодня';
    const n = Math.abs(d);
    const tail = plural(n, 'день', 'дня', 'дней');
    return d < 0 ? `просрочено на ${n} ${tail}` : `через ${n} ${tail}`;
  }

  public closed(p: CreatorProject): number {
    return Math.max(0, p.publications_total - p.publications_open);
  }

  /**
   * Состояние проекта на карточке.
   *
   * Про ПЕРИОД, а не про проект: проект не заканчивается, когда выполнен
   * план роликов, — он живёт дальше, а закрываются периоды. «Всё сдано»
   * звучало как «проект окончен» и врало дважды: на проекте без единой
   * выкладки оно ещё и поздравляло с несделанным.
   */
  public stateLabel(p: CreatorProject): string {
    if (p.publications_overdue) return `${p.publications_overdue} просрочено`;
    if (p.publications_open) return `${p.publications_open} в работе`;
    // Ноль выкладок — это не «план выполнен», это «работа не начиналась».
    if (!p.publications_total) return 'ещё не начали';
    return 'план периода выполнен';
  }

  /** Зелёным — только то, что действительно сделано. */
  public stateTone(p: CreatorProject): 'crit' | 'warn' | 'neu' | 'ok' {
    if (p.publications_overdue) return 'crit';
    if (p.publications_open) return 'warn';
    // Ноль выкладок — не повод для зелёного: хвалить не за что.
    if (!p.publications_total) return 'neu';
    return 'ok';
  }
}
