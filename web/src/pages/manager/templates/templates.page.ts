import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { ChecklistTemplate } from '@entities/publication/model/publication.types';
import { plural } from '@shared/lib/format';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';

/**
 * Библиотека чеклистов — то, из чего менеджер собирает требования к
 * выкладке в проекте.
 *
 * Раздел на чтение: API отдаёт только список. Правка шаблона — отдельная
 * ручка, которой ещё нет, поэтому кнопок «создать» и «изменить» здесь
 * нет: рисовать их, чтобы они ничего не делали, хуже, чем не рисовать.
 */
@Component({
  selector: 'app-manager-templates',
  standalone: true,
  imports: [CommonModule, ListStateComponent, PageHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './templates.page.html',
  styleUrl: './templates.page.scss',
})
export class ManagerTemplatesPage implements OnInit {
  private readonly api = inject(PublicationApi);

  public readonly items = signal<ChecklistTemplate[]>([]);

  public readonly loading = signal(true);

  public readonly error = signal<string | null>(null);

  public ngOnInit(): void {
    this.fetch();
  }

  public itemsWord(n: number): string {
    return plural(n, 'пункт', 'пункта', 'пунктов');
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.managerChecklistTemplates().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить чеклисты.').message);
      },
    });
  }
}
