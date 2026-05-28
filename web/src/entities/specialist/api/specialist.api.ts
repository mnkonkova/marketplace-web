import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '@shared/api/api-url.token';
import {
  ClarifyMessage,
  ClarifyResponse,
  ClarifySearchParams,
  SearchParams,
  SearchResult,
  SpecialistProfile,
  SummarizeResult,
} from '../model/specialist.types';

@Injectable({ providedIn: 'root' })
export class SpecialistApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public search(params: SearchParams): Observable<SearchResult> {
    let hp = new HttpParams();
    if (params.q) hp = hp.set('q', params.q);
    (params.categories ?? []).forEach((c) => (hp = hp.append('category', c)));
    (params.skills ?? []).forEach((s) => (hp = hp.append('skill', s)));
    if (params.city) hp = hp.set('city', params.city);
    if (params.rate_min != null) hp = hp.set('rate_min', params.rate_min);
    if (params.rate_max != null) hp = hp.set('rate_max', params.rate_max);
    if (params.limit != null) hp = hp.set('limit', params.limit);
    if (params.offset != null) hp = hp.set('offset', params.offset);
    return this.http.get<SearchResult>(`${this.api}/search`, { params: hp });
  }

  public clarify(category: string, history: ClarifyMessage[]): Observable<ClarifyResponse> {
    return this.http.post<ClarifyResponse>(`${this.api}/clarify`, { category, history });
  }

  summarize(params: ClarifySearchParams, targetCategory = ''): Observable<SummarizeResult> {
    return this.http.post<SummarizeResult>(`${this.api}/search/summarize`, {
      q: params.q ?? '',
      categories: params.categories ?? [],
      skills: params.skills ?? [],
      city: params.city ?? '',
      rate_min: params.rate_min,
      rate_max: params.rate_max,
      limit: 20,
      target_category: targetCategory,
    });
  }

  public getById(id: string): Observable<SpecialistProfile> {
    return this.http.get<SpecialistProfile>(`${this.api}/specialists/${id}`);
  }
}
