import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_URL } from '@shared/api/api-url.token';
import { Category, CategoryStat, Skill } from '../model/category.types';

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

  public skills(): Observable<Skill[]> {
    return this.http.get<{ items: Skill[] }>(`${this.api}/skills`).pipe(map((r) => r.items ?? []));
  }
}
