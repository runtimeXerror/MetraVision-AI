import type { ReportAmendment } from '../store/reportDraftStore';
import type { Report } from '../types';

import { request } from './api';
import { reportToHtml } from './documents/reportDocument';
import type { DocumentSource } from './exportService';
import { toInspection, type InspectionDTO } from './mappers';

/**
 * Reports.
 *
 * The backend assembles the report as a presentation-shaped snapshot of the
 * inspection at issue time, so an amendment later cannot silently rewrite a
 * document that has already been served.
 */

interface ReportDTO {
  inspectionId: string;
  generatedAt: string;
  inspector: { id: string; name: string; inspectorId: string; role: string };
  business: { name: string };
  location: { address: string };
  product: { category?: string; name?: string; origin?: string };
  images: InspectionDTO['images'];
  extractedFields: InspectionDTO['extractedFields'];
  aiAnalysis?: InspectionDTO['aiAnalysis'];
  complianceResult?: InspectionDTO['complianceResult'];
  review?: { completedFieldCount: number; pendingFieldCount: number; lastReviewedAt?: string };
  notes: string[];
  status: string;
  createdAt: string;
  finalizedAt?: string;
}

/**
 * Fetches the report for an inspection.
 *
 * Returned as a `Report` wrapping a full `Inspection` snapshot, which is the
 * shape the report screen was already written against.
 */
export async function getReport(inspectionId: string): Promise<Report> {
  const dto = await request<ReportDTO>(`/inspections/${inspectionId}/report`);

  // The report payload is the inspection reshaped; rebuild the inspection view
  // from it so the screen has one consistent object to render.
  const snapshot = toInspection({
    id: inspectionId,
    inspectionId: dto.inspectionId,
    inspector: dto.inspector,
    business: dto.business,
    location: dto.location,
    productCategory: dto.product.category,
    productName: dto.product.name,
    images: dto.images,
    extractedFields: dto.extractedFields,
    aiAnalysis: dto.aiAnalysis,
    complianceResult: dto.complianceResult,
    review: dto.review,
    notes: dto.notes[0],
    finalNotes: dto.notes[1],
    status: dto.status,
    createdAt: dto.createdAt,
    updatedAt: dto.generatedAt,
    finalizedAt: dto.finalizedAt,
  });

  return {
    id: `${inspectionId}:report`,
    referenceId: dto.inspectionId.replace('INS-', 'RPT-'),
    title: `${dto.business.name} — ${dto.product.name ?? 'Packaged Product'}`,
    inspectionId,
    generatedBy: dto.inspector.name,
    generatedAt: dto.generatedAt,
    snapshot,
  };
}

/**
 * The report as an exportable document.
 *
 * Rendered on the device from the report payload the API already returned, so
 * exporting costs no extra round trip and works on a connection that has since
 * dropped — which is the connection an inspector standing in a shop usually
 * has. The payload is a snapshot taken at issue time, so a document exported
 * today and re-exported next month reproduces the same record.
 */
export function reportDocument(report: Report, amendment?: ReportAmendment): DocumentSource {
  const business = amendment?.businessName ?? report.snapshot.details.businessName;

  return {
    baseName: `${report.referenceId} ${business}`,
    html: () => reportToHtml(report, amendment),
  };
}
