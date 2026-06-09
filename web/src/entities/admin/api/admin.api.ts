import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { TokenPair } from '@entities/auth/model/auth.types';

export interface ManagerInfo {
  user_id: string;
  email?: string;
  display_name?: string;
  is_active: boolean;
  is_approved: boolean;
  email_verified: boolean;
  assigned_projects: number;
  created_at: string;
}

export interface CreateClientResult {
  user_id: string;
  invite_token?: string;
  invite_url?: string;
}

export interface InviteGenerateResult {
  token: string;
  url: string;
  expires_at: string;
}

export interface RedeemResp {
  user_id: string;
  tokens: TokenPair;
}

// Модерация публикаций специалистов (admin only).
// См. marketplace-api/docs/SPECIALIST_MODERATION.md.

export interface ModerationQueueItem {
  user_id: string;
  email?: string;
  display_name: string;
  avatar_url?: string;
  bio: string;
  city?: string;
  primary_category?: string;
  is_freelance: boolean;
  production_name?: string;
  updated_at: string;
  moderation_status: 'pending_review' | 'approved' | 'rejected';
  moderation_reason?: string;
}

export type ModerationListStatus = 'pending_review' | 'approved' | 'rejected' | 'all';

// PublicProfile для admin'ского просмотра (отдаётся /admin/moderation/specialists/{id}).
// Совпадает по форме с обычной PublicProfile (включая portfolio/categories/skills),
// но видит и pending, и rejected — публичная ручка их прячет.
export interface ModerationSpecialistDetail {
  user_id: string;
  display_name: string;
  bio: string;
  avatar_url?: string;
  city?: string;
  rate_min?: number;
  rate_max?: number;
  currency: string;
  rating_avg: number;
  reviews_count: number;
  production_name?: string;
  is_freelance: boolean;
  categories: { code: string; title: string; is_primary: boolean }[];
  skills: { id: string; slug: string; title: string; kind: string }[];
  portfolio: {
    id: string;
    title: string;
    description: string;
    video_url?: string;
    thumbnail_url?: string;
    external_url?: string;
    preview_url?: string;
    preview_status: string;
    category_codes: string[];
    sort_order: number;
    created_at: string;
    updated_at: string;
  }[];
  // optimistic-lock версия профиля. Фронт обязан прислать её обратно при
  // Approve/Reject, чтобы admin не одобрил устаревшую версию (см. backend
  // SetModerationDecisionInTx).
  updated_at: string;
  moderation_status: 'pending_review' | 'approved' | 'rejected';
  moderation_reason?: string;
  email?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public listManagers(approved?: boolean): Observable<{ items: ManagerInfo[] }> {
    let url = `${this.api}/admin/managers`;
    if (approved !== undefined) {
      url += `?is_approved=${approved}`;
    }
    return this.http.get<{ items: ManagerInfo[] }>(url);
  }

  public approveManager(id: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/managers/${id}/approve`, {});
  }

  public revokeManager(id: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/managers/${id}/revoke`, {});
  }

  public createClient(body: {
    email: string;
    display_name: string;
    generate_invite: boolean;
  }): Observable<CreateClientResult> {
    return this.http.post<CreateClientResult>(`${this.api}/admin/users`, body);
  }

  public generateInvite(userId: string): Observable<InviteGenerateResult> {
    return this.http.post<InviteGenerateResult>(
      `${this.api}/admin/users/${userId}/generate_invite`,
      {},
    );
  }

  // Делает существующего юзера менеджером + (если sendInvite=true) сразу
  // выдаёт magic-link. Идемпотентно: повторный вызов на уже-менеджере
  // просто перегенерит invite. is_approved=TRUE ставится одновременно.
  public promoteToManager(
    userId: string,
    sendInvite: boolean,
  ): Observable<InviteGenerateResult> {
    return this.http.post<InviteGenerateResult>(
      `${this.api}/admin/managers/promote`,
      { user_id: userId, send_invite: sendInvite },
    );
  }

  public redeemInvite(token: string): Observable<RedeemResp> {
    return this.http.post<RedeemResp>(`${this.api}/auth/redeem_invite/${token}`, {});
  }

  // ─── Модерация специалистов ──────────────────────────────────────

  public listModerationQueue(
    status: ModerationListStatus = 'pending_review',
    limit = 20,
    offset = 0,
  ): Observable<{ items: ModerationQueueItem[]; total: number }> {
    return this.http.get<{ items: ModerationQueueItem[]; total: number }>(
      `${this.api}/admin/moderation/specialists`,
      { params: { status, limit, offset } },
    );
  }

  public pendingModerationCount(): Observable<{ pending_count: number }> {
    return this.http.get<{ pending_count: number }>(
      `${this.api}/admin/moderation/specialists/count`,
    );
  }

  public getSpecialistForModeration(userId: string): Observable<ModerationSpecialistDetail> {
    return this.http.get<ModerationSpecialistDetail>(
      `${this.api}/admin/moderation/specialists/${userId}`,
    );
  }

  public approveSpecialist(userId: string, expectedUpdatedAt?: string): Observable<void> {
    return this.http.post<void>(
      `${this.api}/admin/moderation/specialists/${userId}/approve`,
      { expected_updated_at: expectedUpdatedAt },
    );
  }

  public rejectSpecialist(
    userId: string,
    reason: string,
    expectedUpdatedAt?: string,
  ): Observable<void> {
    return this.http.post<void>(
      `${this.api}/admin/moderation/specialists/${userId}/reject`,
      { reason, expected_updated_at: expectedUpdatedAt },
    );
  }
}
