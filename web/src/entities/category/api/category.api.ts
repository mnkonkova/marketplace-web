import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_URL } from '@shared/api/api-url.token';
import { Category, CategoryStat, Skill } from '../model/category.types';

export interface SkillsQuery {
  /** Несколько категорий одним запросом — вместо N запросов по одной. */
  categories?: string[];
  category?: string;
  kind?: 'tool' | 'platform' | 'genre' | 'skill';
}

@Injectable({ providedIn: 'root' })
export class CategoryApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public list(): Observable<Category[]> {
    return this.http
      .get<{ items: Category[] }>(`${this.api}/categories`)
      .pipe(map((r) => r.items ?? []));
  }

  public stats(): Observable<Record<string, number>> {
    return this.http.get<{ items: CategoryStat[] }>(`${this.api}/categories/stats`).pipe(
      map((r) => {
        const out: Record<string, number> = {};
        for (const it of r.items ?? []) {
          out[it.code] = it.count;
        }
        return out;
      }),
    );
  }

  public skills(query: SkillsQuery = {}): Observable<Skill[]> {
    let params = new HttpParams();
    // Категорий может быть несколько: кабинет спрашивает навыки сразу по всем
    // выбранным ролям. Раньше это был запрос на каждую — пять ролей давали
    // пять запросов и пять CORS-preflight'ов на один клик.
    if (query.category) params = params.set('category', query.category);
    if (query.categories?.length) params = params.set('category', query.categories.join(','));
    if (query.kind) params = params.set('kind', query.kind);
    return this.http
      .get<{ items: Skill[] }>(`${this.api}/skills`, { params })
      .pipe(map((r) => r.items ?? []));
  }
}
