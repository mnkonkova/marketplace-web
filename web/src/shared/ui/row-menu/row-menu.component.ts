import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';

/** Пункт меню строки. `code` — то, что прилетит в `pick`. */
export interface RowMenuItem {
  code: string;
  label: string;
  /** Разрушающее действие: красным и только через подтверждение. */
  danger?: boolean;
  /**
   * Вопрос подтверждения. У разрушающих обязателен — без него пункт
   * срабатывает с первого промаха мышью.
   */
  confirm?: string;
  disabled?: boolean;
}

/**
 * Меню строки таблицы — «⋯» справа.
 *
 * До этого действия стояли кнопками в ряд прямо в ячейке: у пользователей
 * их набиралось до пяти, строка переносилась, и «Deactivate» оказывался
 * вплотную к «Подтвердить». Одинаковые по весу кнопки не говорят, какая
 * из них редкая и необратимая, — а именно она стояла последней и ближе
 * всех к краю, куда и уводит мышь.
 *
 * Поэтому: одна точка входа, разрушающее — красным и внизу, и всегда
 * через подтверждение с названием того, что исчезнет.
 */
@Component({
  selector: 'app-row-menu',
  standalone: true,
  imports: [NzDropDownModule, NzPopconfirmModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="dots"
      nz-dropdown
      nzTrigger="click"
      [nzDropdownMenu]="menu"
      nzPlacement="bottomRight"
      [attr.aria-label]="label()"
      (click)="$event.stopPropagation()"
    >
      ⋯
    </button>
    <nz-dropdown-menu #menu="nzDropdownMenu">
      <!-- Роли проставлены руками: ng-zorro их не ставит, и меню, которое
           не называет себя меню, экранному диктору не читается как меню. -->
      <ul nz-menu class="row-menu" role="menu">
        @for (it of items(); track it.code) {
          @if (it.confirm) {
            <li
              nz-menu-item
              role="menuitem"
              [nzDisabled]="!!it.disabled"
              [class.danger]="it.danger"
              nz-popconfirm
              [nzPopconfirmTitle]="it.confirm"
              nzPopconfirmPlacement="left"
              nzOkText="Да"
              nzCancelText="Отмена"
              [nzOkDanger]="!!it.danger"
              (nzOnConfirm)="pick.emit(it.code)"
              (click)="$event.stopPropagation()"
            >
              {{ it.label }}
            </li>
          } @else {
            <li
              nz-menu-item
              role="menuitem"
              [nzDisabled]="!!it.disabled"
              [class.danger]="it.danger"
              (click)="$event.stopPropagation(); pick.emit(it.code)"
            >
              {{ it.label }}
            </li>
          }
        }
      </ul>
    </nz-dropdown-menu>
  `,
  styles: [
    `
      .dots {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 9px;
        background: none;
        color: var(--text-muted);
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
      }

      .dots:hover {
        border-color: var(--border-strong, rgba(255, 255, 255, 0.16));
        color: var(--text);
      }
    `,
  ],
})
export class RowMenuComponent {
  public readonly items = input<RowMenuItem[]>([]);

  /** Что это за строка — попадает в aria-label кнопки. */
  public readonly label = input('Действия со строкой');

  public readonly pick = output<string>();
}
