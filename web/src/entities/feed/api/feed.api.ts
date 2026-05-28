import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '@shared/api/api-url.token';
import { FeedParams, FeedResponse } from '../model/feed.types';

@Injectable({ providedIn: 'root' })
export class FeedApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public load(params: FeedParams): Observable<FeedResponse> {
    let hp = new HttpParams();
    (params.categories ?? []).forEach((c) => (hp = hp.append('category', c)));
    (params.skills ?? []).forEach((s) => (hp = hp.append('skill', s)));
    if (params.ids?.length) hp = hp.set('ids', params.ids.join(','));
    if (params.cursor) hp = hp.set('cursor', params.cursor);
    return this.http.get<FeedResponse>(`${this.api}/feed`, { params: hp });
  }
}
