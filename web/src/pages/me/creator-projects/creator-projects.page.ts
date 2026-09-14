import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { CreatorProject } from '@entities/publication/model/publication.types';
import { dueLabel } from '@entities/publication/lib/publication-status';
import { parseApiError } from '@shared/api/api-error';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { BackLinkComponent } from '@shared/nav/back-link.component';

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
  imports: [
    CommonModule,
    RouterLink,
    NzSpinModule,
    NzTagModule,
    AppHeaderComponent,
    BackLinkComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-projects.page.html',
  styleUrl: './creator-projects.page.scss',
})
export class CreatorProjectsPage {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly items = signal<CreatorProject[]>([]);

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

  public due(date: string): string {
    return dueLabel(date);
  }

  public closed(p: CreatorProject): number {
    return Math.max(0, p.publications_total - p.publications_open);
  }
}
