export interface LeadSpecialistContact {
  user_id: string;
  display_name: string;
  contact_email?: string;
  contact_phone?: string;
}

export interface CreateLeadResponse {
  id: string;
  specialists?: LeadSpecialistContact[];
}

export interface LeadSubmitFormValue {
  client_name: string;
  client_contact: string;
  brief: string;
  budget_min: number | null;
  budget_max: number | null;
  deadline: Date | null;
}

export interface CreateLeadPayload {
  client_name: string;
  client_contact: string;
  brief: string;
  specialist_ids: string[];
  budget_min?: number;
  budget_max?: number;
  deadline?: string;
}

export interface LeadSuccessModalData {
  message: string;
  specialists: LeadSpecialistContact[];
}
