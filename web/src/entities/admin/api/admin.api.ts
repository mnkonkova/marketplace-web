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

  public redeemInvite(token: string): Observable<RedeemResp> {
    return this.http.post<RedeemResp>(`${this.api}/auth/redeem_invite/${token}`, {});
  }
}
