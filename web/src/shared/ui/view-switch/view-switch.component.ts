import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ProjectsView } from '@entities/project/lib/project-filters';

/**
 * Переключатель «Список · Канбан».
 *
 * Список и канбан были двумя адресами — `/admin/projects` и
 * `/admin/board`, — и это читалось как два раздела: фильтры, набранные в
 * одном, во втором не действовали, а в сайдбаре оба занимали по пункту.
 * На деле это один раздел, показанный по-разному, и переключатель стоит
 * там, где такие вещи и переключают, — в шапке самого раздела.
 *
 * Вид живёт в query-параметре, поэтому ссылка «вот эти проекты канбаном»
 * открывается канбаном.
 */
@Component({
  selector: 'app-view-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="seg" role="group" aria-label="Вид списка">
      <button
        type="button"
        [class.on]="view() === 'list'"
        [attr.aria-pressed]="view() === 'list'"
        (click)="pick.emit('list')"
      >
        Список
      </button>
      <button
        type="button"
        [class.on]="view() === 'board'"
        [attr.aria-pressed]="view() === 'board'"
        (click)="pick.emit('board')"
      >
        Канбан
      </button>
    </div>
  `,
  styles: [
    `
      .seg {
        display: inline-flex;
        flex: 0 0 auto;
        padding: 2px;
        border: 1px solid var(--border-strong);
        border-radius: 10px;
        background: var(--bg-elevated);
      }

      button {
        min-height: 30px;
        padding: 0 11px;
        border: none;
        border-radius: 8px;
        background: none;
        color: var(--text-muted);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }

      button:hover {
        color: var(--text);
      }

      button.on {
        background: var(--surface-hover);
        color: var(--text);
        box-shadow: inset 0 0 0 1px var(--border-hover);
      }
    `,
  ],
})
export class ViewSwitchComponent {
  public readonly view = input<ProjectsView>('list');

  public readonly pick = output<ProjectsView>();
}
