import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { DocumentTemplatesComponent } from '@widgets/document-templates/document-templates.component';

/**
 * Документы — библиотека шаблонов договоров, актов и NDA.
 *
 * Отдельный раздел сразу под прайсом, а не вкладка на его странице: под
 * словом «Прайс» шаблоны договоров не искали. Устроены так же: версия
 * после публикации не правится, шаблон уходит в архив, а не удаляется.
 */
@Component({
  selector: 'app-admin-documents',
  standalone: true,
  imports: [PageHeadComponent, DocumentTemplatesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-head
      title="Документы"
      subtitle="Шаблоны, которые менеджер выдаёт креаторам и заказчикам в проекте."
    />
    <div class="crm-page">
      <app-document-templates />
    </div>
  `,
})
export class AdminDocumentsPage {}
