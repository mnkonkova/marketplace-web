import { Injectable, signal } from '@angular/core';

/**
 * Кого показывает карточка человека.
 *
 * Открывают её из трёх мест — команды, модерации и списка пользователей,
 * — а рисуется она одна на всю CRM, поверх содержимого. Общий сигнал
 * дешевле, чем копия панели в каждом разделе: копии разъезжаются, а
 * карточка обязана выглядеть одинаково, откуда бы её ни открыли.
 */
@Injectable({ providedIn: 'root' })
export class PersonCardStore {
  public readonly userId = signal<string | null>(null);

  private returnTo: HTMLElement | null = null;

  public open(userId: string, from?: EventTarget | Element | null): void {
    this.returnTo = from instanceof HTMLElement ? from : null;
    this.userId.set(userId);
  }

  /** Закрыть и вернуть фокус туда, откуда открыли. */
  public close(): HTMLElement | null {
    const back = this.returnTo;
    this.returnTo = null;
    this.userId.set(null);
    return back;
  }
}
