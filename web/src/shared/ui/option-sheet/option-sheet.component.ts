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

  /**
   * Панель ЭТОЙ шторки. Ищем от точки касания, а не через
   * document.querySelector: шторок в DOM несколько (теги, продакшен, канал),
   * и глобальный поиск всегда возвращал первую — тянулась и уезжала чужая.
   */
  private panel: HTMLElement | null = null;

  /** Прокручиваемый список внутри листа, если жест начался на нём. */
  private list: HTMLElement | null = null;

  private lastY = 0;

  private dragging = false;

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
  //
  // Жест ловим на всей шторке, а не только на полоске-ручке: целиться в
  // полоску пальцем неудобно, а закрывают лист привычным движением с любого
  // места. Если содержимое прокручено — сначала докручиваем его вверх, и
  // только от самого верха начинается перетаскивание, иначе список нельзя
  // было бы листать.

  public onDragStart(ev: TouchEvent): void {
    const target = ev.target as HTMLElement | null;
    this.list = (target?.closest('.opt-list') as HTMLElement | null) ?? null;
    this.panel = target?.closest('.ant-drawer-content-wrapper') ?? null;
    this.startY = ev.touches[0].clientY;
    this.lastY = this.startY;
    this.shift = 0;
    this.dragging = true;
    if (this.panel) this.panel.style.transition = 'none';
  }

  public onDragMove(ev: TouchEvent): void {
    if (!this.dragging) return;
    const y = ev.touches[0].clientY;
    const delta = y - this.lastY;
    this.lastY = y;

    // Прокрутку списка ведём сами. Отдать её браузеру нельзя: тогда он
    // забирает жест целиком, и смахивание с области списка переставало
    // закрывать лист. Панель двигаем только когда список уже вверху и палец
    // идёт вниз — обычное поведение нижних листов.
    const list = this.list;
    if (list && (list.scrollTop > 0 || delta < 0)) {
      const before = list.scrollTop;
      list.scrollTop = before - delta;
      // Список действительно прокрутился — значит жест был про него.
      if (list.scrollTop !== before) {
        this.startY = y;
        this.shift = 0;
        if (this.panel) this.panel.style.transform = '';
        return;
      }
    }

    const dy = y - this.startY;
    if (dy <= 0) return;
    this.shift = dy;
    // Пока тянем лист — фон стоять на месте: на iOS overflow:hidden на html
    // прокрутку не удерживает.
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
    this.list = null;
    this.shift = 0;
    this.dragging = false;
  }
}
