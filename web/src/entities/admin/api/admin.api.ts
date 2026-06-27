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

// Строка в полном admin-листинге /admin/users (см. /admin/users page).
export interface UserListItem {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: 'client' | 'specialist' | 'both';
  is_admin: boolean;
  is_manager: boolean;
  is_approved: boolean;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
  // Только у спецов: pending_review | approved | rejected.
  // Пустая строка/undefined у клиентов и спецов без профиля.
  moderation_status?: 'pending_review' | 'approved' | 'rejected' | '';
  // Спец нажал «Опубликовать»? Если false и status=pending_review —
  // это черновик, не в очереди модерации (висит до клика «Опубликовать»).
  is_published?: boolean;
}

export interface UserListResult {
  items: UserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListAllUsersParams {
  q?: string;
  kind?: 'client' | 'specialist';
  role?: 'manager' | 'admin' | 'regular';
  limit?: number;
  offset?: number;
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
    // kind: 'video' (default) | 'image' — определяет рендер на admin-странице.
    // Для 'image' карточка показывает images[], для 'video' — preview_url/video_url.
    kind?: 'video' | 'image';
    video_url?: string;
    thumbnail_url?: string;
    external_url?: string;
    preview_url?: string;
    preview_status: string;
    category_codes: string[];
    sort_order: number;
    created_at: string;
    updated_at: string;
    // Фото-кейсы: массив картинок (используется когда kind='image').
    images?: { id: string; image_url: string; sort_order?: number }[];
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

  // Полный листинг всех юзеров для /admin/users. Backend сам валидирует
  // kind/role и clamp'ит limit (1..100).
  public listAllUsers(params: ListAllUsersParams = {}): Observable<UserListResult> {
    const httpParams: Record<string, string> = {};
    if (params.q) httpParams['q'] = params.q;
    if (params.kind) httpParams['kind'] = params.kind;
    if (params.role) httpParams['role'] = params.role;
    if (params.limit !== undefined) httpParams['limit'] = String(params.limit);
    if (params.offset !== undefined) httpParams['offset'] = String(params.offset);
    return this.http.get<UserListResult>(`${this.api}/admin/users`, { params: httpParams });
  }

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

  // Админский bypass email-верификации. Идемпотентно: повторный вызов
  // не меняет email_verified_at. Для ручного заноса клиента (когда контакты
  // уже сверены офлайн и не хочется гонять magic-link).
  public verifyEmail(userId: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/users/${userId}/verify_email`, {});
  }

  // Мягкое отключение юзера: is_active=false. Логин блокируется, в выдаче
  // не светится. Админов через этот endpoint деактивировать нельзя (400).
  public deactivateUser(userId: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/users/${userId}/deactivate`, {});
  }

  public activateUser(userId: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/users/${userId}/activate`, {});
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
