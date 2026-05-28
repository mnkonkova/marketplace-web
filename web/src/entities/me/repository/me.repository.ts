import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_URL } from '@shared/api/api-url.token';
import { MeUser } from '@entities/auth/model/auth.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import {
  MeProfile,
  MeProfilePatch,
  PortfolioCreateInput,
  ProfileCheckResult,
  UploadURLResponse,
} from '../model/me.types';

@Injectable({ providedIn: 'root' })
export class MeRepository {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public getUser(): Observable<MeUser> {
    return this.http.get<MeUser>(`${this.api}/me`);
  }

  public getProfile(): Observable<MeProfile> {
    return this.http.get<MeProfile>(`${this.api}/me/profile`);
  }

  public patchProfile(payload: MeProfilePatch): Observable<MeProfile> {
    return this.http.patch<MeProfile>(`${this.api}/me/profile`, payload);
  }

  public unpublishProfile(): Observable<MeProfile> {
    return this.http.post<MeProfile>(`${this.api}/me/profile/unpublish`, {});
  }

  public publishProfile(): Observable<MeProfile> {
    return this.http.post<MeProfile>(`${this.api}/me/profile/publish`, {});
  }

  public checkProfile(display_name: string, bio: string): Observable<ProfileCheckResult> {
    return this.http.post<ProfileCheckResult>(`${this.api}/me/profile/check`, {
      display_name,
      bio,
    });
  }

  public setCategories(codes: string[], primary: string): Observable<MeProfile> {
    return this.http.put<MeProfile>(`${this.api}/me/profile/categories`, {
      codes,
      primary,
    });
  }

  public setSkills(payload: { skill_ids: string[]; updated_at: string }): Observable<MeProfile> {
    return this.http.put<MeProfile>(`${this.api}/me/profile/skills`, payload);
  }

  public presignAvatarUpload(file: File): Observable<UploadURLResponse> {
    return this.presignUpload('/me/uploads/image', file);
  }

  public presignPortfolioUpload(file: File): Observable<UploadURLResponse> {
    return this.presignUpload('/me/portfolio/upload-url', file);
  }

  public listPortfolio(): Observable<PortfolioItem[]> {
    return this.http
      .get<{ items: PortfolioItem[] }>(`${this.api}/me/portfolio`)
      .pipe(map((r) => r.items ?? []));
  }

  public addPortfolio(input: PortfolioCreateInput): Observable<PortfolioItem> {
    return this.http.post<PortfolioItem>(`${this.api}/me/portfolio`, input);
  }

  public deletePortfolio(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/me/portfolio/${encodeURIComponent(id)}`);
  }

  public updatePortfolioCategories(id: string, codes: string[]): Observable<PortfolioItem> {
    return this.http.put<PortfolioItem>(
      `${this.api}/me/portfolio/${encodeURIComponent(id)}/categories`,
      { codes },
    );
  }

  private presignUpload(endpoint: string, file: File): Observable<UploadURLResponse> {
    return this.http.post<UploadURLResponse>(`${this.api}${endpoint}`, {
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    });
  }
}
