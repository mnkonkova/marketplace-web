import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Значки нижней полосы. Имена — из макета. */
export type SotkaIcon =
  | 'grid'
  | 'chart'
  | 'wallet'
  | 'chat'
  | 'cal'
  | 'doc'
  | 'bell'
  | 'check'
  | 'users'
  | 'coin';

export interface SotkaTab {
  key: string;
  title: string;
  icon: SotkaIcon;
  /** Красный счётчик: просрочки и неоплаченное. 0 — значка нет. */
  badge?: number;
}

/**
 * Нижняя полоса разделов — тач-версия вкладок кабинета.
 *
 * На телефоне разделы уезжают вниз, в зону большого пальца: верхний ряд
 * вкладок на 390 px либо не помещается, либо ужимается до подписей, в
 * которые не попасть. Это то же самое переключение, что и на десктопе, и
 * состояние у него общее — компонент только показывает и сообщает о
 * нажатии.
 *
 * Пять мест максимум: шестая вкладка на 390 px даёт цель уже 60 px, а
 * это меньше пальца. Что не помещается, уходит в «Ещё» — решает место
 * вызова, здесь только рисуется.
 */
@Component({
  selector: 'app-sotka-tabbar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sotka-tabbar.component.html',
  styleUrl: './sotka-tabbar.component.scss',
})
export class SotkaTabbarComponent {
  public readonly tabs = input<readonly SotkaTab[]>([]);

  public readonly current = input('');

  public readonly pick = output<string>();
}
