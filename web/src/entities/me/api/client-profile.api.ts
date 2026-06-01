import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';

export interface ClientProfile {
  user_id: string;
  display_name: string;
  phone: string;
  telegram: string;
}

export interface ClientProfilePatch {
  display_name?: string;
  phone?: string;
  telegram?: string;
}

@Injectable({ providedIn: 'root' })
export class ClientProfileApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public get(): Observable<ClientProfile> {
    return this.http.get<ClientProfile>(`${this.api}/me/client-profile`);
  }

  public patch(body: ClientProfilePatch): Observable<ClientProfile> {
    return this.http.patch<ClientProfile>(`${this.api}/me/client-profile`, body);
  }
}
