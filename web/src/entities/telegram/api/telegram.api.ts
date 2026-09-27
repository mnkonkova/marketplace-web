import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';

import { TelegramBot, TelegramLinkStart, TelegramStatus } from '../model/telegram.types';

@Injectable({ providedIn: 'root' })
export class TelegramApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public status(): Observable<TelegramStatus> {
    return this.http.get<TelegramStatus>(`${this.api}/me/telegram`);
  }

  // Ссылка подключения. Код внутри неё одноразовый и живёт пятнадцать
  // минут: человек нажимает кнопку и тут же идёт в Telegram.
  public linkCode(bot: TelegramBot): Observable<TelegramLinkStart> {
    return this.http.post<TelegramLinkStart>(`${this.api}/me/telegram/link-code`, { bot });
  }

  public unlink(bot: TelegramBot): Observable<void> {
    return this.http.delete<void>(`${this.api}/me/telegram/link`, {
      params: new HttpParams().set('bot', bot),
    });
  }
}
