import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '@shared/api/api-url.token';
import { MeUser } from '../model/auth.types';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public me(): Observable<MeUser> {
    return this.http.get<MeUser>(`${this.api}/me`);
  }
}
