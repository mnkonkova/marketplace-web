import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';

export interface SheetOption {
  value: string;
  label: string;
  /** Пункт виден, но не переключается (например, последний тег работы). */
  locked?: boolean;
}

/** Насколько нужно протянуть вниз, чтобы шторка закрылась. */
const SWIPE_CLOSE_PX = 90;

/**
 * Нижняя шторка выбора — одна на все списки кабинета: теги работы, продакшен,
 * канал связи. На телефоне выпадающий список у края экрана прижимается к
 * границе и половина пунктов уезжает под палец, поэтому вместо него шторка.
 *
 * Один компонент вместо трёх похожих: режим `multiple` отличает теги (можно
 * отметить несколько, шторка не закрывается) от выбора продакшена и канала
 * (один пункт, после выбора закрывается).
 *
 * Стили без инкапсуляции: содержимое рендерится в оверлее ng-zorro, вне
 * DOM-поддерева компонента, и scoped-правила до него не достают. Классы
 * с префиксом opt- — чтобы не пересечься с остальным.
 */
@Component({
  selector: 'app-option-sheet',
  standalone: true,
  imports: [NzDrawerModule],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './option-sheet.component.html',
  styleUrl: './option-sheet.component.scss',
})
export class OptionSheetComponent {
  public readonly open = input(false);

  public readonly title = input('Выбор');

  public readonly note = input('');

  public readonly options = input<readonly SheetOption[]>([]);

  /** Выбранные значения. Для одиночного выбора — массив из одного элемента. */
  public readonly selected = input<readonly string[]>([]);

  public readonly multiple = input(false);

  public readonly picked = output<string>();

  public readonly closed = output<void>();

  private startY = 0;

  private shift = 0;

  public isOn(value: string): boolean {
    return this.selected().includes(value);
  }

  public choose(option: SheetOption): void {
    if (option.locked) return;
    this.picked.emit(option.value);
    // Одиночный выбор закрывается сразу; множественный оставляем открытым,
    // иначе на каждый тег приходится открывать шторку заново.
    if (!this.multiple()) this.close();
  }

  public close(): void {
    this.resetPanel();
    this.closed.emit();
  }

  // === Смахивание ===
  // Крестика нет: шторку закрывают жестом вниз, как системные меню. Панель
  // тянется за пальцем, чтобы жест был с обратной связью.

  private panel(): HTMLElement | null {
    return document.querySelector('.ant-drawer-content-wrapper');
  }

  public onGripStart(ev: TouchEvent): void {
    this.startY = ev.touches[0].clientY;
    this.shift = 0;
    const el = this.panel();
    if (el) el.style.transition = 'none';
  }

  public onGripMove(ev: TouchEvent): void {
    // Только вниз: вверх шторка не растёт.
    this.shift = Math.max(0, ev.touches[0].clientY - this.startY);
    const el = this.panel();
    if (el) el.style.transform = `translateY(${this.shift}px)`;
  }

  public onGripEnd(): void {
    const shouldClose = this.shift > SWIPE_CLOSE_PX;
    this.resetPanel();
    if (shouldClose) this.closed.emit();
  }

  private resetPanel(): void {
    const el = this.panel();
    if (el) {
      el.style.transition = '';
      el.style.transform = '';
    }
    this.shift = 0;
  }
}
