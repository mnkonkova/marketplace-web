import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

const STORAGE_KEY = 'marketpclce.cookie_consent.v1';

type ConsentValue = 'all' | 'essential' | null;

@Component({
  selector: 'app-cookie-banner',
  standalone: true,
  templateUrl: './cookie-banner.component.html',
  styleUrl: './cookie-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CookieBannerComponent {
  // visible — управляет показом баннера. true пока юзер не выбрал.
  // Default = !!localStorage.getItem(STORAGE_KEY) === false (показ нужен).
  public readonly visible = signal<boolean>(readConsent() === null);

  public acceptAll(): void {
    saveConsent('all');
    this.visible.set(false);
    // На будущее: подключение Метрики/Analytics должно слушать это
    // событие через CookieConsentService. Шлём CustomEvent чтобы не
    // тянуть RxJS-Subject ради одной перезагрузки сценария.
    window.dispatchEvent(new CustomEvent('cookie-consent', { detail: 'all' }));
  }

  public acceptEssential(): void {
    saveConsent('essential');
    this.visible.set(false);
    window.dispatchEvent(new CustomEvent('cookie-consent', { detail: 'essential' }));
  }
}

function readConsent(): ConsentValue {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'all' || v === 'essential') return v;
    return null;
  } catch {
    return null;
  }
}

function saveConsent(v: 'all' | 'essential'): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* private mode / disabled storage — баннер просто будет показываться каждый раз */
  }
}

/** Хелпер для интеграций (например Метрика): подключаем трекинг только
 * если юзер согласился на 'all'. Subscribe на 'cookie-consent' event
 * для реактивной активации после клика. */
export function hasFullCookieConsent(): boolean {
  return readConsent() === 'all';
}
