import type { Inspection, InspectionReport, Paged } from '@/types/api';

import { get } from './client';

/**
 * Reports.
 *
 * The backend returns a structured report payload; rendering it to PDF is
 * deliberately not done here. A browser-side PDF of an enforcement record would
 * be produced from whatever the operator's screen happened to contain, which is
 * the wrong provenance for a document that may be served on a dealer. When it
 * is needed it belongs on the server, rendered from the same payload.
 */

export function getInspectionReport(id: string): Promise<InspectionReport> {
  return get<InspectionReport>(`/inspections/${id}/report`);
}

export interface ReportListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  productCategory?: string;
  from?: string;
  to?: string;
}

/**
 * The reports index.
 *
 * A report is not a stored entity — it is a rendering of an inspection. So the
 * list of "available reports" is the list of inspections that have been
 * assessed, which is what this asks for.
 */
export function listReportableInspections(
  filters: ReportListFilters = {},
): Promise<Paged<Inspection>> {
  return get<Paged<Inspection>>('/inspections', {
    ...filters,
    sort: 'newest',
  } as Record<string, unknown>);
}
