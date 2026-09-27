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

  // Билет привязки из мини-аппа: сессии ещё нет, а подпись Telegram
  // есть. Билет уезжает в адрес анкеты и гасится после регистрации.
  public linkTicket(bot: TelegramBot, initData: string): Observable<{ code: string }> {
    return this.http.post<{ code: string }>(`${this.api}/auth/telegram/link-ticket`, {
      bot,
      init_data: initData,
    });
  }

  // Предъявить билет из-под свежей сессии: телеграм привяжется к
  // только что заведённому аккаунту.
  public claim(code: string): Observable<unknown> {
    return this.http.post(`${this.api}/me/telegram/claim`, { code });
  }

  public unlink(bot: TelegramBot): Observable<void> {
    return this.http.delete<void>(`${this.api}/me/telegram/link`, {
      params: new HttpParams().set('bot', bot),
    });
  }
}
