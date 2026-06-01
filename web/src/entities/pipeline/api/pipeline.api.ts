import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import {
  Pipeline,
  PipelineFull,
  PipelineStage,
  PipelineStep,
} from '../model/pipeline.types';

@Injectable({ providedIn: 'root' })
export class PipelineApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  public list(): Observable<{ items: Pipeline[] }> {
    return this.http.get<{ items: Pipeline[] }>(`${this.api}/admin/pipelines`);
  }

  // Чтение структуры воронки для всех залогиненных (нужно менеджеру для
  // канбана). На бэке — /api/v1/pipelines/{id} под общим auth.Middleware.
  public getFull(id: string): Observable<PipelineFull> {
    return this.http.get<PipelineFull>(`${this.api}/pipelines/${id}`);
  }

  public get(id: string): Observable<PipelineFull> {
    return this.http.get<PipelineFull>(`${this.api}/admin/pipelines/${id}`);
  }

  public create(body: {
    name: string;
    description: string;
    revisions_included: number;
  }): Observable<Pipeline> {
    return this.http.post<Pipeline>(`${this.api}/admin/pipelines`, body);
  }

  public patch(
    id: string,
    body: Partial<Pipeline>,
  ): Observable<Pipeline> {
    return this.http.patch<Pipeline>(`${this.api}/admin/pipelines/${id}`, body);
  }

  public addStage(pipelineId: string, body: { name: string; sort_order: number }): Observable<PipelineStage> {
    return this.http.post<PipelineStage>(`${this.api}/admin/pipelines/${pipelineId}/stages`, body);
  }

  public patchStage(stageId: string, body: { name?: string; sort_order?: number }): Observable<PipelineStage> {
    return this.http.patch<PipelineStage>(`${this.api}/admin/pipelines/stages/${stageId}`, body);
  }

  public deleteStage(stageId: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/admin/pipelines/stages/${stageId}`);
  }

  public addStep(
    stageId: string,
    body: Omit<PipelineStep, 'id' | 'stage_id' | 'created_at'>,
  ): Observable<PipelineStep> {
    return this.http.post<PipelineStep>(
      `${this.api}/admin/pipelines/stages/${stageId}/steps`,
      body,
    );
  }

  public patchStep(stepId: string, body: Partial<PipelineStep>): Observable<PipelineStep> {
    return this.http.patch<PipelineStep>(`${this.api}/admin/pipelines/steps/${stepId}`, body);
  }

  public deleteStep(stepId: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/admin/pipelines/steps/${stepId}`);
  }

  public reorder(
    pipelineId: string,
    stages: { id: string; sort_order: number; steps: { id: string; sort_order: number }[] }[],
  ): Observable<void> {
    return this.http.put<void>(`${this.api}/admin/pipelines/${pipelineId}/reorder`, { stages });
  }
}
