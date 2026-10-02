import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '@shared/api/api-url.token';
import {
  DeliverDocumentInput,
  DocAudience,
  DocumentTemplate,
  MyDocument,
  NewTemplateInput,
  TemplateVersion,
  UserDocument,
} from '../model/document.types';

interface ListResp<T> {
  items: T[];
}

// Документы: библиотека шаблонов (админ), выдача человеку (менеджер) и
// «Мои документы» (креатор и заказчик). Ничего не удаляется: шаблон
// уходит в архив, выданный документ отзывается.
@Injectable({ providedIn: 'root' })
export class DocumentApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  // ---- админ: шаблоны ----

  public adminTemplates(withArchived: boolean): Observable<ListResp<DocumentTemplate>> {
    const params = withArchived ? new HttpParams().set('archived', '1') : undefined;
    return this.http.get<ListResp<DocumentTemplate>>(`${this.api}/admin/document_templates`, {
      params,
    });
  }

  public adminCreateTemplate(input: NewTemplateInput): Observable<DocumentTemplate> {
    return this.http.post<DocumentTemplate>(`${this.api}/admin/document_templates`, input);
  }

  public adminPublishVersion(id: string, url: string, note: string): Observable<TemplateVersion> {
    return this.http.post<TemplateVersion>(`${this.api}/admin/document_templates/${id}/versions`, {
      url,
      note,
    });
  }

  public adminArchiveTemplate(id: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/document_templates/${id}/archive`, {});
  }

  public adminRestoreTemplate(id: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/document_templates/${id}/restore`, {});
  }

  // ---- менеджер: выдача ----

  public managerTemplates(audience?: DocAudience): Observable<ListResp<DocumentTemplate>> {
    const params = audience ? new HttpParams().set('audience', audience) : undefined;
    return this.http.get<ListResp<DocumentTemplate>>(`${this.api}/manager/document_templates`, {
      params,
    });
  }

  public managerProjectDocuments(projectId: string): Observable<ListResp<UserDocument>> {
    return this.http.get<ListResp<UserDocument>>(
      `${this.api}/manager/projects/${projectId}/documents`,
    );
  }

  public managerDeliver(
    projectId: string,
    input: DeliverDocumentInput,
  ): Observable<ListResp<UserDocument>> {
    return this.http.post<ListResp<UserDocument>>(
      `${this.api}/manager/projects/${projectId}/documents`,
      input,
    );
  }

  public managerRevoke(projectId: string, docId: string, revoke: boolean): Observable<void> {
    const action = revoke ? 'revoke' : 'unrevoke';
    return this.http.post<void>(
      `${this.api}/manager/projects/${projectId}/documents/${docId}/${action}`,
      {},
    );
  }

  // ---- мои документы ----

  /**
   * projectId — только документы этого проекта; без него — по всем.
   * personalOnly — только выданное лично, без договоров из материалов.
   */
  public myDocuments(projectId = '', personalOnly = false): Observable<ListResp<MyDocument>> {
    const params: Record<string, string> = {};
    if (projectId) params['project_id'] = projectId;
    if (personalOnly) params['source'] = 'personal';
    return this.http.get<ListResp<MyDocument>>(`${this.api}/me/documents`, { params });
  }

  public markOpened(id: string): Observable<{ opened_at: string }> {
    return this.http.post<{ opened_at: string }>(`${this.api}/me/documents/${id}/open`, {});
  }
}
