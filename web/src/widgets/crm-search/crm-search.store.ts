import { Injectable, signal } from '@angular/core';

/**
 * Открыт ли ⌘K-поиск.
 *
 * Отдельным хранилищем, потому что открыть его могут двое и с разных
 * этажей: кнопка в сайдбаре и горячая клавиша, которую слушает та же
 * оболочка. Держать флаг в оболочке и пробрасывать его вниз входом
 * значило бы связать панель с местом, где она нарисована, — а нужна она
 * из любого раздела.
 */
@Injectable({ providedIn: 'root' })
export class CrmSearchStore {
  public readonly open = signal(false);

  /**
   * Кто держал фокус до открытия. Хранится здесь, а не в панели, по той
   * же причине: открывают её из двух мест, а вернуть фокус надо туда,
   * откуда открыли, — иначе после Escape он оказывается на <body> и
   * следующий Tab начинает обход страницы заново.
   */
  private returnTo: HTMLElement | null = null;

  public show(from?: EventTarget | Element | null): void {
    this.returnTo = from instanceof HTMLElement ? from : null;
    this.open.set(true);
  }

  public hide(): HTMLElement | null {
    const back = this.returnTo;
    this.returnTo = null;
    this.open.set(false);
    return back;
  }
}
