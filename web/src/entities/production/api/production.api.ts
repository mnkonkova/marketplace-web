import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { Production } from '../model/production.types';

interface ListResp {
  items: Production[];
}

@Injectable({ providedIn: 'root' })
export class ProductionApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public listActive(): Observable<ListResp> {
    return this.http.get<ListResp>(`${this.api}/productions`);
  }

  public listAll(): Observable<ListResp> {
    return this.http.get<ListResp>(`${this.api}/admin/productions`);
  }

  public create(body: { name: string; description: string }): Observable<Production> {
    return this.http.post<Production>(`${this.api}/admin/productions`, body);
  }

  public patch(
    id: string,
    body: { name?: string; description?: string; is_active?: boolean },
  ): Observable<Production> {
    return this.http.patch<Production>(`${this.api}/admin/productions/${id}`, body);
  }

  public delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/admin/productions/${id}`);
  }
}
