import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { ChecklistTemplate } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { ManagerLayoutComponent } from '@widgets/manager-layout/manager-layout.component';

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
  imports: [CommonModule, ManagerLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './templates.page.html',
  styleUrl: './templates.page.scss',
})
export class ManagerTemplatesPage implements OnInit {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly items = signal<ChecklistTemplate[]>([]);

  public readonly loading = signal(true);

  public ngOnInit(): void {
    this.api.managerChecklistTemplates().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить шаблоны.').message);
      },
    });
  }
}
