import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';

export type SupportTopic = 'payment' | 'bug' | 'feature' | 'other';

export interface SupportMessagePayload {
  from_email: string;
  from_name?: string;
  topic: SupportTopic;
  message: string;
  source_url?: string;
}

@Injectable({ providedIn: 'root' })
export class SupportApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_URL);

  public send(payload: SupportMessagePayload): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.api}/support/messages`, payload);
  }
}
