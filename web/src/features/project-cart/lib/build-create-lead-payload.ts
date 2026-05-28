import { formatDate } from '@angular/common';
import { CreateLeadPayload, LeadSubmitFormValue } from '../model/lead.types';

export function buildCreateLeadPayload(
  form: LeadSubmitFormValue,
  specialistIds: string[],
): CreateLeadPayload {
  const payload: CreateLeadPayload = {
    client_name: form.client_name,
    client_contact: form.client_contact,
    brief: form.brief,
    specialist_ids: specialistIds,
  };

  if (form.budget_min != null && form.budget_min > 0) {
    payload.budget_min = form.budget_min;
  }
  if (form.budget_max != null && form.budget_max > 0) {
    payload.budget_max = form.budget_max;
  }
  if (form.deadline) {
    payload.deadline = formatDate(form.deadline, 'yyyy-MM-dd', 'en-US');
  }

  return payload;
}
