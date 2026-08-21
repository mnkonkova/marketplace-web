import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';

import { ProfileForm } from '@entities/me/model/profile-form';
import { SOCIAL_NETWORKS, SocialKey } from '@shared/lib/social-links';
import { isTouchDevice } from '@shared/lib/touch';
import { OptionSheetComponent, SheetOption } from '@shared/ui/option-sheet/option-sheet.component';

/** Насколько нужно смахнуть строку, чтобы она удалилась. */
const SWIPE_DELETE_PX = 96;

/** Порог, после которого жест считаем горизонтальным, а не прокруткой. */
const SWIPE_LOCK_PX = 10;

/**
 * Вкладка «Контакты»: скрытые контакты для заявок + публичные каналы связи.
 * Как и остальные вкладки, состояние не хранит — пишет в форму страницы.
 *
 * Каналы показываем списком «канал + значение», а не фиксированной сеткой из
 * девяти полей: у большинства заполнены два-три, остальные висели пустыми и
 * растягивали вкладку. Данные при этом те же — social_links, строка = ключ с
 * непустым значением. Контракт сохранения не менялся.
 */
@Component({
  selector: 'app-profile-contacts',
  standalone: true,
  imports: [FormsModule, NzInputModule, OptionSheetComponent],
  templateUrl: './profile-contacts.component.html',
  styleUrl: './profile-contacts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileContactsComponent {
  public readonly form = input.required<ProfileForm>();

  public readonly socialNetworks = SOCIAL_NETWORKS;

  /**
   * Ключи, показанные списком. Отдельный сигнал нужен, потому что строка живёт
   * с момента нажатия «Добавить» и до ввода значения — в social_links её
   * тогда ещё нет.
   */
  private readonly extraKeys = signal<SocialKey[]>([]);

  private readonly swipeKey = signal<SocialKey | null>(null);

  private readonly swipeDx = signal(0);

  private startX = 0;

  private startY = 0;

  private locked: 'x' | 'y' | null = null;

  public readonly isTouch = signal(isTouchDevice());

  /** Канал, для которого открыта шторка. null — шторка закрыта. */
  public readonly channelSheetFor = signal<SocialKey | null>(null);

  public readonly channelSheetOptions = computed<SheetOption[]>(() => {
    const current = this.channelSheetFor();
    return current
      ? this.channelOptions(current).map((n) => ({ value: n.key, label: n.label }))
      : [];
  });

  public channelLabel(key: SocialKey): string {
    return SOCIAL_NETWORKS.find((n) => n.key === key)?.label ?? key;
  }

  public openChannelSheet(key: SocialKey): void {
    this.channelSheetFor.set(key);
  }

  public onChannelPicked(next: string): void {
    const from = this.channelSheetFor();
    if (from) this.changeChannel(from, next as SocialKey);
    this.channelSheetFor.set(null);
  }

  public get f(): ProfileForm {
    return this.form();
  }

  public readonly rows = computed(() => {
    const links = this.form().social_links ?? {};
    const filled = SOCIAL_NETWORKS.filter((n) => (links[n.key] ?? '').trim() !== '').map(
      (n) => n.key,
    );
    const keys = [...filled, ...this.extraKeys().filter((k) => !filled.includes(k))];
    return keys.map((key) => ({ key }));
  });

  /** Каналы, ещё не занятые ни одной строкой. */
  public readonly availableChannels = computed(() => {
    const used = new Set(this.rows().map((r) => r.key));
    return SOCIAL_NETWORKS.filter((n) => !used.has(n.key));
  });

  public readonly swipingKey = computed(() => this.swipeKey());

  /** Список для селекта строки: свободные каналы плюс её собственный. */
  public channelOptions(current: SocialKey): readonly { key: SocialKey; label: string }[] {
    const own = SOCIAL_NETWORKS.find((n) => n.key === current);
    const rest = this.availableChannels();
    return own ? [own, ...rest] : [...rest];
  }

  public placeholderFor(key: SocialKey): string {
    return SOCIAL_NETWORKS.find((n) => n.key === key)?.placeholder ?? '';
  }

  public setValue(key: SocialKey, value: string): void {
    this.f.social_links[key] = value;
    // Значение появилось — строка теперь держится на самих данных.
    if (value.trim()) this.extraKeys.update((keys) => keys.filter((k) => k !== key));
  }

  public addRow(): void {
    const next = this.availableChannels()[0];
    if (next) this.extraKeys.update((keys) => [...keys, next.key]);
  }

  public removeRow(key: SocialKey): void {
    this.f.social_links[key] = '';
    this.extraKeys.update((keys) => keys.filter((k) => k !== key));
    this.resetSwipe();
  }

  /** Смена канала переносит уже введённое значение, а не теряет его. */
  public changeChannel(from: SocialKey, to: SocialKey): void {
    if (from === to) return;
    const value = this.f.social_links[from] ?? '';
    this.f.social_links[from] = '';
    this.f.social_links[to] = value;
    this.extraKeys.update((keys) => {
      const without = keys.filter((k) => k !== from);
      return value.trim() ? without : [...without, to];
    });
  }

  public rowShift(key: SocialKey): string {
    if (this.swipeKey() !== key) return 'translateX(0)';
    return `translateX(${this.swipeDx()}px)`;
  }

  public onTouchStart(ev: TouchEvent, key: SocialKey): void {
    const t = ev.touches[0];
    this.startX = t.clientX;
    this.startY = t.clientY;
    this.locked = null;
    this.swipeKey.set(key);
    this.swipeDx.set(0);
  }

  public onTouchMove(ev: TouchEvent): void {
    if (!this.swipeKey()) return;
    const t = ev.touches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;

    // Направление жеста определяем один раз: иначе строка дёргается вбок при
    // обычной прокрутке страницы пальцем.
    if (!this.locked && Math.abs(dx) + Math.abs(dy) > SWIPE_LOCK_PX) {
      this.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (this.locked !== 'x') return;

    // Тянем только влево: свайп вправо ничего не делает.
    this.swipeDx.set(Math.min(0, dx));
  }

  public onTouchEnd(key: SocialKey): void {
    if (this.locked === 'x' && this.swipeDx() <= -SWIPE_DELETE_PX) {
      this.removeRow(key);
      return;
    }
    this.resetSwipe();
  }

  private resetSwipe(): void {
    this.swipeKey.set(null);
    this.swipeDx.set(0);
    this.locked = null;
  }
}
