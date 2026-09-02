import type { Inspection, InspectionReport, Paged } from '@/types/api';

import { del, get, patch, post } from './client';

/**
 * Inspections.
 *
 * Filtering, searching and paging all happen on the server — see
 * `ListInspectionsQuery` in the backend. The dashboard never pulls the
 * collection down to filter it in the browser.
 */

export interface InspectionFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  productCategory?: string;
  inspectorId?: string;
  district?: string;
  state?: string;
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'score';
}

export function listInspections(filters: InspectionFilters = {}): Promise<Paged<Inspection>> {
  return get<Paged<Inspection>>('/inspections', filters as Record<string, unknown>);
}

export function getInspection(id: string): Promise<Inspection> {
  return get<Inspection>(`/inspections/${id}`);
}

export function updateInspection(id: string, body: Record<string, unknown>): Promise<Inspection> {
  return patch<Inspection>(`/inspections/${id}`, body);
}

export function deleteInspection(id: string): Promise<unknown> {
  return del(`/inspections/${id}`);
}

export function finalizeInspection(id: string, finalNotes?: string): Promise<Inspection> {
  return post<Inspection>(`/inspections/${id}/finalize`, finalNotes ? { finalNotes } : {});
}

export interface ReviewDecision {
  fieldName: string;
  action: 'ACCEPTED' | 'EDITED' | 'MARKED_UNAVAILABLE';
  value?: string | null;
  comment?: string;
}

/**
 * Records a review decision.
 *
 * The backend stores this beside the AI reading and never over it, which is why
 * the detail page can always show both what the model read and what the
 * inspector determined.
 */
export function reviewField(id: string, decision: ReviewDecision): Promise<Inspection> {
  return post<Inspection>(`/inspections/${id}/review`, decision);
}

export function reviewFields(id: string, reviews: ReviewDecision[]): Promise<Inspection> {
  return post<Inspection>(`/inspections/${id}/review`, { reviews });
}

export function getReport(id: string): Promise<InspectionReport> {
  return get<InspectionReport>(`/inspections/${id}/report`);
}
