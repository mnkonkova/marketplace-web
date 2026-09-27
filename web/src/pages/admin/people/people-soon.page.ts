import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import { AdminSummaryStore } from '@entities/admin/model/admin-summary.store';
import { plural } from '@shared/lib/format';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';

interface SectionCopy {
  title: string;
  subtitle: string;
  /** Что здесь будет — одним предложением, без «скоро». */
  plan: string;
  /** Ключ счётчика в nav_counts — тот же, что стоит у пункта в сайдбаре. */
  count: 'specialists' | 'clients';
  /** Как называть этих людей в строке про счётчик. */
  who: [string, string, string];
  /** С каким фильтром открыть их в общем списке. */
  kind: 'specialist' | 'client';
}

const COPY: Record<string, SectionCopy> = {
  specialists: {
    title: 'Специалисты',
    subtitle: 'Кто снимает и монтирует: профили, модерация, ставки.',
    plan:
      'Раздел готовится: здесь будут специалисты отдельным списком — с профилем, ' +
      'статусом модерации и ставками, а не вперемешку с заказчиками.',
    count: 'specialists',
    who: ['специалист', 'специалиста', 'специалистов'],
    kind: 'specialist',
  },
  clients: {
    title: 'Клиенты',
    subtitle: 'Кто заказывает: контакты, проекты, согласие с прайсом.',
    plan:
      'Раздел готовится: здесь будут заказчики отдельным списком — с проектами ' +
      'и версией прайса, под которой стоит их согласие.',
    count: 'clients',
    who: ['клиент', 'клиента', 'клиентов'],
    kind: 'client',
  },
};

/**
 * Заглушка раздела «Люди», у которого пока нет своего экрана.
 *
 * Пустая страница на месте пункта меню читается как поломка: человек
 * нажал, ничего не появилось, и он идёт проверять, не отвалился ли
 * запрос. Поэтому страница говорит прямо: раздела ещё нет, вот что в нём
 * будет, а пока вот где эти же люди лежат сегодня.
 *
 * Ссылка на /admin/users здесь не для полноты: это единственный экран, с
 * которого выдают роль менеджера и блокируют аккаунт, и убрать его из
 * сайдбара, не сказав куда он делся, значило бы спрятать эти действия.
 */
@Component({
  selector: 'app-admin-people-soon',
  standalone: true,
  imports: [RouterLink, PageHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-head [title]="copy().title" [subtitle]="copy().subtitle" />

    <section class="soon">
      <p class="plan">{{ copy().plan }}</p>
      <!-- Цифра у пункта меню обязана совпасть с тем, что человек увидит,
           кликнув. Пока раздела нет, называем её здесь и ведём туда, где
           эти строки лежат сегодня. -->
      <p class="now">
        {{ countLine() }} Они в общем списке —
        <a routerLink="/admin/users" [queryParams]="{ kind: copy().kind }">Все пользователи</a>. Там
        же выдают роль менеджера, подтверждают почту и блокируют аккаунт.
      </p>
    </section>
  `,
  styles: [
    `
      .soon {
        max-width: 620px;
        padding: 22px 24px;
        border: 1px dashed var(--border-strong, rgba(255, 255, 255, 0.16));
        border-radius: var(--r-card, 16px);
        background: var(--surface);
      }

      .plan {
        margin: 0;
        color: var(--text);
        font-size: 14.5px;
        line-height: 1.5;
      }

      .now {
        margin: 12px 0 0;
        color: var(--text-muted);
        font-size: 13.5px;
        line-height: 1.5;
      }

      a {
        color: var(--cta);
      }
    `,
  ],
})
export class AdminPeopleSoonPage {
  private readonly route = inject(ActivatedRoute);

  private readonly summary = inject(AdminSummaryStore);

  private readonly section = toSignal(
    this.route.data.pipe(map((d) => (d['section'] as string) ?? 'specialists')),
    { initialValue: 'specialists' },
  );

  public readonly copy = computed<SectionCopy>(() => COPY[this.section()] ?? COPY['specialists']);

  public readonly countLine = computed(() => {
    const c = this.copy();
    const n = this.summary.data()?.nav_counts?.[c.count];
    if (n == null) return '';
    return `Сейчас их ${n} ${plural(n, ...c.who)}.`;
  });
}
