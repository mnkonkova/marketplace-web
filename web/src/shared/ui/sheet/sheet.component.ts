import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';

/** Насколько нужно протянуть вниз, чтобы лист закрылся. */
const SWIPE_CLOSE_PX = 90;

/**
 * Нижний лист с произвольным содержимым — одна штука на все формы.
 *
 * Рядом живёт app-option-sheet: там выбор из списка, здесь — форма,
 * которую пишет место вызова. Общее у них устройство: drawer ng-zorro
 * снизу, прокручиваемое тело, закрытие смахиванием и по фону. Общее
 * именно поэтому и вынесено: своя «шторка» из position: fixed выглядит
 * так же ровно до первого длинного содержимого — она не прокручивается,
 * и нижние поля формы становятся недоступны.
 *
 * Содержимое проецируется: состояние формы и её сохранение остаются у
 * того экрана, которому принадлежат.
 *
 * Стили без инкапсуляции: содержимое рендерится в оверлее ng-zorro, вне
 * DOM-поддерева компонента, и scoped-правила до него не достают.
 * Префикс sh- — чтобы не пересечься с остальным.
 */
@Component({
  selector: 'app-sheet',
  standalone: true,
  imports: [NzDrawerModule],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sheet.component.html',
  styleUrl: './sheet.component.scss',
})
export class SheetComponent {
  public readonly open = input(false);

  public readonly title = input('');

  /** Одна строка пояснения под заголовком. */
  public readonly note = input('');

  public readonly closed = output<void>();

  public close(): void {
    this.resetPanel();
    this.closed.emit();
  }

  // === Смахивание ===
  //
  // Жест ловим на всей шторке, а не только на полоске-ручке: целиться в
  // полоску пальцем неудобно. Если тело прокручено — сначала докручиваем
  // его вверх, и только от самого верха начинается перетаскивание,
  // иначе длинную форму нельзя было бы листать.

  private startY = 0;

  private shift = 0;

  private panel: HTMLElement | null = null;

  private body: HTMLElement | null = null;

  private dragging = false;

  public onDragStart(ev: TouchEvent): void {
    const target = ev.target as HTMLElement | null;
    // С полей ввода жест не начинаем: тянуть лист, попав в текстовое
    // поле, — это промах, а не намерение закрыть.
    if (target?.closest('input, textarea, select')) {
      this.dragging = false;
      return;
    }
    const body = target?.closest('.sh-body') as HTMLElement | null;
    if (body && body.scrollHeight > body.clientHeight && body.scrollTop > 0) {
      this.dragging = false;
      return;
    }
    this.body = body;
    this.panel = target?.closest('.ant-drawer-content-wrapper') ?? null;
    this.startY = ev.touches[0].clientY;
    this.shift = 0;
    this.dragging = true;
    if (this.panel) this.panel.style.transition = 'none';
  }

  public onDragMove(ev: TouchEvent): void {
    if (!this.dragging) return;
    const dy = ev.touches[0].clientY - this.startY;
    if (dy <= 0) {
      if (this.body && this.body.scrollHeight > this.body.clientHeight) this.dragging = false;
      return;
    }
    this.shift = dy;
    ev.preventDefault();
    if (this.panel) this.panel.style.transform = `translateY(${dy}px)`;
  }

  public onDragEnd(): void {
    if (!this.dragging) return;
    const shouldClose = this.shift > SWIPE_CLOSE_PX;
    this.resetPanel();
    if (shouldClose) this.closed.emit();
  }

  private resetPanel(): void {
    if (this.panel) {
      this.panel.style.transition = '';
      this.panel.style.transform = '';
    }
    this.panel = null;
    this.body = null;
    this.shift = 0;
    this.dragging = false;
  }
}
