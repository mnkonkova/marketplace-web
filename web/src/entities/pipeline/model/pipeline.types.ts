export interface Pipeline {
  id: string;
  name: string;
  description: string;
  version: number;
  is_active: boolean;
  revisions_included: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface PipelineStageFull extends PipelineStage {
  steps: PipelineStep[];
}

export interface PipelineStep {
  id: string;
  stage_id: string;
  name: string;
  owner: 'client' | 'team' | 'system';
  duration_days: number;
  visible_to_client: boolean;
  visible_to_specialist: boolean;
  weight: number;
  sort_order: number;
  is_review: boolean;
  created_at: string;
}

export interface PipelineFull extends Pipeline {
  stages: PipelineStageFull[];
}
