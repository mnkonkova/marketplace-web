import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { NavHistoryService } from '@shared/nav/nav-history.service';
import { captureTelegramTicket } from '@shared/lib/telegram-claim';
import { trackKeyboardInset } from '@shared/lib/keyboard-inset';
import { initTelegramApp } from '@shared/lib/telegram-webapp';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
  `,
})
export class AppComponent {
  // Eager-inject: сервис listenит NavigationEnd с момента создания. Без
  // этого первая навигация (например /feed) не попадала в стек — BackLink
  // создавался уже на /specialist/:id, history был пустым.
  private readonly _nav = inject(NavHistoryService);

  private readonly router = inject(Router);

  private readonly location = inject(Location);

  public constructor() {
    // Билет привязки телеграма, приехавший из мини-аппа в адресе
    // анкеты. Снимаем ДО первой навигации: роутер вычистит query, и
    // после него брать будет неоткуда.
    captureTelegramTicket();

    // Высота экранной клавиатуры — в CSS-переменную. Свойство всего
    // приложения, как и мини-апп ниже: формы в нижних шторках есть на
    // половине экранов, и ветвиться на каждой значит однажды забыть.
    trackKeyboardInset();

    // Мини-апп Telegram. Вне его вызов не делает ничего: те же экраны
    // открывают в обычном браузере, и ветвиться на каждом значит
    // однажды забыть. Здесь — потому что это свойство ВСЕГО
    // приложения: шапка, вибрация и кнопка «назад» нужны на каждом
    // экране, а не только на входе.
    const syncBack = initTelegramApp(() => this.location.back());
    syncBack(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => syncBack(e.urlAfterRedirects));
  }
}
