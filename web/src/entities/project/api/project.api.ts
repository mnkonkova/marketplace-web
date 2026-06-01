import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import {
  ProjectClientView,
  ProjectComment,
  ProjectEvent,
  ProjectFullView,
  ProjectManagerView,
  ProjectStepView,
} from '../model/project.types';

interface ListResp<T> {
  items: T[];
}

@Injectable({ providedIn: 'root' })
export class ProjectApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  // ---- Client ----
  public listClientProjects(): Observable<ListResp<ProjectClientView>> {
    return this.http.get<ListResp<ProjectClientView>>(`${this.api}/me/projects`);
  }

  public getClientFunnel(projectId: string): Observable<ProjectClientView> {
    return this.http.get<ProjectClientView>(`${this.api}/me/projects/${projectId}/funnel`);
  }

  public clientSubmitReview(projectId: string, stepId: string): Observable<ProjectStepView> {
    return this.http.post<ProjectStepView>(
      `${this.api}/me/projects/${projectId}/steps/${stepId}/submit_review`,
      {},
    );
  }

  public clientListComments(projectId: string): Observable<ListResp<ProjectComment>> {
    return this.http.get<ListResp<ProjectComment>>(`${this.api}/me/projects/${projectId}/comments`);
  }

  public clientCreateComment(projectId: string, body: string): Observable<ProjectComment> {
    return this.http.post<ProjectComment>(
      `${this.api}/me/projects/${projectId}/comments`,
      { body },
    );
  }

  // ---- Manager ----
  public managerInbox(): Observable<ListResp<ProjectManagerView>> {
    return this.http.get<ListResp<ProjectManagerView>>(`${this.api}/manager/projects/inbox`);
  }

  public managerAssigned(): Observable<ListResp<ProjectManagerView>> {
    return this.http.get<ListResp<ProjectManagerView>>(`${this.api}/manager/projects`);
  }

  public managerClaim(projectId: string): Observable<void> {
    return this.http.post<void>(`${this.api}/manager/projects/${projectId}/claim`, {});
  }

  public managerGetFull(projectId: string): Observable<ProjectFullView> {
    return this.http.get<ProjectFullView>(`${this.api}/manager/projects/${projectId}`);
  }

  public managerAdvanceStage(
    projectId: string,
    updatedAt?: string,
  ): Observable<ProjectFullView> {
    return this.http.post<ProjectFullView>(
      `${this.api}/manager/projects/${projectId}/advance_stage`,
      updatedAt ? { updated_at: updatedAt } : {},
    );
  }

  public managerMoveStage(
    projectId: string,
    targetStageId: string,
    updatedAt?: string,
  ): Observable<ProjectFullView> {
    return this.http.post<ProjectFullView>(
      `${this.api}/manager/projects/${projectId}/move_stage`,
      updatedAt
        ? { target_stage_id: targetStageId, updated_at: updatedAt }
        : { target_stage_id: targetStageId },
    );
  }

  public managerMoveStep(
    projectId: string,
    targetStepId: string,
    updatedAt?: string,
  ): Observable<ProjectFullView> {
    return this.http.post<ProjectFullView>(
      `${this.api}/manager/projects/${projectId}/move_step`,
      updatedAt
        ? { target_step_id: targetStepId, updated_at: updatedAt }
        : { target_step_id: targetStepId },
    );
  }

  public managerStartStep(projectId: string, stepId: string): Observable<ProjectStepView> {
    return this.http.post<ProjectStepView>(
      `${this.api}/manager/projects/${projectId}/steps/${stepId}/start`,
      {},
    );
  }

  public managerCompleteStep(projectId: string, stepId: string): Observable<ProjectStepView> {
    return this.http.post<ProjectStepView>(
      `${this.api}/manager/projects/${projectId}/steps/${stepId}/complete`,
      {},
    );
  }

  public managerSkipStep(
    projectId: string,
    stepId: string,
    comment: string,
  ): Observable<ProjectStepView> {
    return this.http.post<ProjectStepView>(
      `${this.api}/manager/projects/${projectId}/steps/${stepId}/skip`,
      { comment },
    );
  }

  public managerListEvents(projectId: string): Observable<ListResp<ProjectEvent>> {
    return this.http.get<ListResp<ProjectEvent>>(
      `${this.api}/manager/projects/${projectId}/events`,
    );
  }

  public managerListComments(projectId: string): Observable<ListResp<ProjectComment>> {
    return this.http.get<ListResp<ProjectComment>>(
      `${this.api}/manager/projects/${projectId}/comments`,
    );
  }

  public managerApproveSpecialist(projectId: string): Observable<{ specialist_user_id: string }> {
    return this.http.post<{ specialist_user_id: string }>(
      `${this.api}/manager/projects/${projectId}/approve_specialist`,
      {},
    );
  }

  public managerRejectSpecialist(projectId: string, reason: string): Observable<void> {
    return this.http.post<void>(
      `${this.api}/manager/projects/${projectId}/reject_specialist`,
      { reason },
    );
  }

  public managerCreateComment(
    projectId: string,
    body: string,
    isInternal: boolean,
  ): Observable<ProjectComment> {
    return this.http.post<ProjectComment>(
      `${this.api}/manager/projects/${projectId}/comments`,
      { body, is_internal: isInternal },
    );
  }

  // ---- Admin ----
  public adminListProjects(status?: string): Observable<ListResp<ProjectManagerView>> {
    const url = `${this.api}/admin/projects${status ? `?status=${status}` : ''}`;
    return this.http.get<ListResp<ProjectManagerView>>(url);
  }

  public adminGetProject(projectId: string): Observable<ProjectFullView> {
    return this.http.get<ProjectFullView>(`${this.api}/admin/projects/${projectId}`);
  }

  public adminCreateProject(body: {
    client_user_id: string;
    pipeline_id: string;
    title: string;
    budget?: number;
    notes?: string;
  }): Observable<ProjectClientView> {
    return this.http.post<ProjectClientView>(`${this.api}/admin/projects`, body);
  }

  public adminAdvanceStage(
    projectId: string,
    updatedAt?: string,
  ): Observable<ProjectFullView> {
    return this.http.post<ProjectFullView>(
      `${this.api}/admin/projects/${projectId}/advance_stage`,
      updatedAt ? { updated_at: updatedAt } : {},
    );
  }

  public adminMoveStage(
    projectId: string,
    targetStageId: string,
    updatedAt?: string,
  ): Observable<ProjectFullView> {
    return this.http.post<ProjectFullView>(
      `${this.api}/admin/projects/${projectId}/move_stage`,
      updatedAt
        ? { target_stage_id: targetStageId, updated_at: updatedAt }
        : { target_stage_id: targetStageId },
    );
  }

  public adminMoveStep(
    projectId: string,
    targetStepId: string,
    updatedAt?: string,
  ): Observable<ProjectFullView> {
    return this.http.post<ProjectFullView>(
      `${this.api}/admin/projects/${projectId}/move_step`,
      updatedAt
        ? { target_step_id: targetStepId, updated_at: updatedAt }
        : { target_step_id: targetStepId },
    );
  }

  // Назначить/снять менеджера на проекте. managerUserId=null → unassign.
  public adminAssignManager(
    projectId: string,
    managerUserId: string | null,
  ): Observable<void> {
    return this.http.post<void>(
      `${this.api}/admin/projects/${projectId}/assign`,
      { manager_user_id: managerUserId },
    );
  }

  public adminListEvents(projectId: string): Observable<ListResp<ProjectEvent>> {
    return this.http.get<ListResp<ProjectEvent>>(`${this.api}/admin/projects/${projectId}/events`);
  }

  public adminListComments(projectId: string): Observable<ListResp<ProjectComment>> {
    return this.http.get<ListResp<ProjectComment>>(
      `${this.api}/admin/projects/${projectId}/comments`,
    );
  }

  public adminCreateComment(
    projectId: string,
    body: string,
    isInternal: boolean,
  ): Observable<ProjectComment> {
    return this.http.post<ProjectComment>(
      `${this.api}/admin/projects/${projectId}/comments`,
      { body, is_internal: isInternal },
    );
  }
}
