import { Injectable, computed, signal } from '@angular/core';
import { SpecialistLite } from '@entities/specialist/model/specialist.types';

const CART_KEY = 'marketpclce.cart.v1';

@Injectable({ providedIn: 'root' })
export class ProjectCartStore {
  private readonly items = signal<SpecialistLite[]>(this.read());

  public readonly count = computed(() => this.items().length);

  public readonly specialists = computed(() => this.items());

  public has(userId: string): boolean {
    return this.items().some((s) => s.user_id === userId);
  }

  public toggle(spec: SpecialistLite): boolean {
    const exists = this.has(spec.user_id);
    const next = exists
      ? this.items().filter((s) => s.user_id !== spec.user_id)
      : [...this.items(), spec];
    this.persist(next);
    return !exists;
  }

  public remove(userId: string): void {
    this.persist(this.items().filter((s) => s.user_id !== userId));
  }

  public clear(): void {
    this.persist([]);
  }

  /** Сброс в памяти без записи (после полной очистки storage при logout). */
  public resetMemory(): void {
    this.items.set([]);
  }

  private persist(next: SpecialistLite[]): void {
    this.items.set(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
  }

  private read(): SpecialistLite[] {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return [];
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
}
