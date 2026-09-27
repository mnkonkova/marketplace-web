import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { AdminProjectsSort, ProjectKind, ProjectStatus } from '../model/project.types';
import {
  CommentInput,
  CommentParticipant,
  CommentThread,
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

// Параметры сужения переписки. Без thread ручка отдаёт все ветки сразу —
// пустой параметр слать нельзя, бэк ответит bad_thread.
function threadParams(thread?: CommentThread, creatorId?: string): HttpParams {
  let params = new HttpParams();
  if (thread) params = params.set('thread', thread);
  if (thread === 'creator' && creatorId) params = params.set('creator_id', creatorId);
  return params;
}

// Параметры админского списка проектов. Все опциональны: без них ручка
// отдаёт первую страницу (20 строк, свежие сверху, без тестовых).
export interface AdminProjectsParams {
  // Поиск по названию проекта и по клиенту. Короче 2 символов сервер
  // игнорирует — по одной букве совпадёт весь список.
  q?: string;
  // Точный статус проекта либо 'unfinished' — четыре незавершённых одним
  // набором (draft|active|on_hold|dispute). Пусто = всё, кроме отменённых.
  status?: ProjectStatus | 'unfinished';
  // Ветка: креаторы или продакшн. Списки у них разные по смыслу — у
  // одних план выкладок, у других шаги воронки, — и смотрят их порознь.
  kind?: ProjectKind;
  // uuid менеджера либо 'none' — проекты без ответственного. «Никого»
  // нельзя выразить пустым значением: пустое значит «любой».
  manager?: string;
  include_test?: boolean;
  sort?: AdminProjectsSort;
  limit?: number;
  offset?: number;
}

export interface AdminProjectsResult {
  items: ProjectManagerView[];
  // Сколько строк под текущими фильтрами всего — для пагинатора.
  total: number;
  limit: number;
  offset: number;
}

export interface CreateProjectPayload {
  // Вид проекта. Воронку при создании не выбирают: продакшну сервер
  // подставляет её по умолчанию, остальным она не нужна.
  kind: ProjectKind;
  title: string;
  notes?: string;
  budget?: number;
  // Пометить проект как тестовый: админский список такие прячет.
  is_test?: boolean;
  // Один из двух обязателен.
  client_user_id?: string;
  client_name?: string;
  client_contact?: string;
  specialist_user_id?: string;
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

  // Создаёт запись в reviews (rating + text). Клиент дёрнет после неё
  // clientSubmitReview, чтобы закрыть review-шаг проекта одной кнопкой
  // на UI. Бек проверит через lead_id, что клиент был автором лида,
  // а target — принятым получателем.
  public createReview(payload: {
    lead_id?: string;
    target_user_id: string;
    rating: number;
    text: string;
  }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.api}/reviews`, payload);
  }

  public clientListComments(projectId: string): Observable<ListResp<ProjectComment>> {
    return this.http.get<ListResp<ProjectComment>>(`${this.api}/me/projects/${projectId}/comments`);
  }

  // Клиентская ветка. Ни переписки менеджера с креаторами, ни внутренних
  // заметок клиент не видит — ветку выбирает ручка, параметров не нужно.
  public clientCreateComment(projectId: string, input: CommentInput): Observable<ProjectComment> {
    return this.http.post<ProjectComment>(`${this.api}/me/projects/${projectId}/comments`, input);
  }

  public clientCommentParticipants(projectId: string): Observable<ListResp<CommentParticipant>> {
    return this.http.get<ListResp<CommentParticipant>>(
      `${this.api}/me/projects/${projectId}/comments/participants`,
    );
  }

  // ---- Creator ----

  // Своя ветка с менеджером. Какая именно — решает сервер по токену.
  public creatorListComments(projectId: string): Observable<ListResp<ProjectComment>> {
    return this.http.get<ListResp<ProjectComment>>(
      `${this.api}/me/creator/projects/${projectId}/comments`,
    );
  }

  public creatorCreateComment(projectId: string, input: CommentInput): Observable<ProjectComment> {
    return this.http.post<ProjectComment>(
      `${this.api}/me/creator/projects/${projectId}/comments`,
      input,
    );
  }

  public creatorCommentParticipants(projectId: string): Observable<ListResp<CommentParticipant>> {
    return this.http.get<ListResp<CommentParticipant>>(
      `${this.api}/me/creator/projects/${projectId}/comments/participants`,
    );
  }

  // ---- Manager ----
  public managerInbox(): Observable<ListResp<ProjectManagerView>> {
    return this.http.get<ListResp<ProjectManagerView>>(`${this.api}/manager/projects/inbox`);
  }

  // Создать проект менеджером. Клиент задаётся одним из двух способов:
  // 1) client_user_id (зарегистрированный);
  // 2) client_name + client_contact (no-account, контакт пришёл по телефону).
  // Менеджер автоматически становится assigned_to — отдельный claim не нужен.
  public managerCreateProject(payload: CreateProjectPayload): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.api}/manager/projects`, payload);
  }

  // Тот же DTO, но через admin-роут: assigned_to_user_id передаётся явно
  // (админ может назначить любого менеджера).
  public adminCreateProject(
    payload: CreateProjectPayload & { assigned_to_user_id?: string },
  ): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.api}/admin/projects`, payload);
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

  // Без параметров — вся переписка разом: клиентская ветка, ветки
  // креаторов и внутренние заметки. thread сужает до одной; для creator
  // обязателен creatorId.
  public managerListComments(
    projectId: string,
    thread?: CommentThread,
    creatorId?: string,
  ): Observable<ListResp<ProjectComment>> {
    return this.http.get<ListResp<ProjectComment>>(
      `${this.api}/manager/projects/${projectId}/comments`,
      { params: threadParams(thread, creatorId) },
    );
  }

  public managerCommentParticipants(
    projectId: string,
    thread?: CommentThread,
    creatorId?: string,
  ): Observable<ListResp<CommentParticipant>> {
    return this.http.get<ListResp<CommentParticipant>>(
      `${this.api}/manager/projects/${projectId}/comments/participants`,
      { params: threadParams(thread, creatorId) },
    );
  }

  public managerApproveSpecialist(projectId: string): Observable<{ specialist_user_id: string }> {
    return this.http.post<{ specialist_user_id: string }>(
      `${this.api}/manager/projects/${projectId}/approve_specialist`,
      {},
    );
  }

  public managerRejectSpecialist(projectId: string, reason: string): Observable<void> {
    return this.http.post<void>(`${this.api}/manager/projects/${projectId}/reject_specialist`, {
      reason,
    });
  }

  // Назначить спеца напрямую (минуя proposed). Используется когда проект
  // создан вручную или предложенный спец был отклонён.
  public managerAssignSpecialist(projectId: string, specialistID: string): Observable<void> {
    return this.http.post<void>(`${this.api}/manager/projects/${projectId}/assign_specialist`, {
      specialist_user_id: specialistID,
    });
  }

  public adminAssignSpecialist(projectId: string, specialistID: string): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/projects/${projectId}/assign_specialist`, {
      specialist_user_id: specialistID,
    });
  }

  // Ветку менеджер выбирает сам полем thread (плюс creator_id для
  // креаторской). Прежнее is_internal бэк тоже понимает, но раз ветка
  // теперь явная, шлём её.
  public managerCreateComment(projectId: string, input: CommentInput): Observable<ProjectComment> {
    return this.http.post<ProjectComment>(
      `${this.api}/manager/projects/${projectId}/comments`,
      input,
    );
  }

  // ---- Admin ----

  // Поиск, фильтры, сортировка и страница считаются на сервере. Тянуть
  // весь список в браузер ради одного фильтра — тупик: проектов
  // становится больше, а размер ответа и так был ограничен сверху.
  public adminListProjects(params: AdminProjectsParams = {}): Observable<AdminProjectsResult> {
    let httpParams = new HttpParams();
    // Пустые значения не шлём: `status=` бэк прочитал бы как «фильтра
    // нет», но в URL он выглядел бы как выбранный фильтр.
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.status) httpParams = httpParams.set('status', params.status);
    // Ветку слать обязательно: без неё выпадашка «Все ветки / Креаторы /
    // Продакшн» выглядела рабочей и не делала ничего — сервер параметр
    // принимает, а мы его не клали. Фильтр, который притворяется
    // исправным, хуже отсутствующего: по нему принимают решения.
    if (params.kind) httpParams = httpParams.set('kind', params.kind);
    if (params.manager) httpParams = httpParams.set('manager', params.manager);
    if (params.include_test) httpParams = httpParams.set('include_test', 'true');
    if (params.sort) httpParams = httpParams.set('sort', params.sort);
    if (params.limit !== undefined) httpParams = httpParams.set('limit', String(params.limit));
    if (params.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    return this.http.get<AdminProjectsResult>(`${this.api}/admin/projects`, {
      params: httpParams,
    });
  }

  public adminGetProject(projectId: string): Observable<ProjectFullView> {
    return this.http.get<ProjectFullView>(`${this.api}/admin/projects/${projectId}`);
  }

  /**
   * Вернуть отменённый проект в тот статус, в котором он был до отмены.
   * 409 — отменяли до появления ручки или правили статус руками: угаданный
   * статус молча поменял бы, кого проект ждёт.
   */
  public adminRestoreProject(projectId: string): Observable<{ status: ProjectStatus }> {
    return this.http.post<{ status: ProjectStatus }>(
      `${this.api}/admin/projects/${projectId}/restore`,
      {},
    );
  }

  /** Пометить проект тестовым или снять пометку: тестовые в списках скрыты. */
  public adminMarkProjectTest(projectId: string, isTest: boolean): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/projects/${projectId}/mark_test`, {
      is_test: isTest,
    });
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
  public adminAssignManager(projectId: string, managerUserId: string | null): Observable<void> {
    return this.http.post<void>(`${this.api}/admin/projects/${projectId}/assign`, {
      manager_user_id: managerUserId,
    });
  }

  // Soft-delete: status=cancelled, физически чистится через 30 дней.
  public adminCancelProject(projectId: string, reason: string): Observable<void> {
    return this.http.request<void>('delete', `${this.api}/admin/projects/${projectId}`, {
      body: { reason },
    });
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
    return this.http.post<ProjectComment>(`${this.api}/admin/projects/${projectId}/comments`, {
      body,
      is_internal: isInternal,
    });
  }
}
