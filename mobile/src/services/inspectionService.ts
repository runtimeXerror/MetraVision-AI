import {
  ApiError,
  type ComplianceStatus,
  type Inspection,
  type InspectionDetails,
  type InspectionListQuery,
  type InspectionListResponse,
  type ProductImage,
  type ReportStats,
  type ReviewAction,
} from '../types';

import { request } from './api';
import {
  toInspection,
  toInspectionSummary,
  toWireCategory,
  toWireComplianceStatus,
  toWireReviewAction,
  toWireSide,
  type InspectionDTO,
} from './mappers';

/**
 * Inspection lifecycle against the backend.
 *
 * Every function returns the mobile domain shape, so the stores and screens
 * that consumed the Phase 1 mock layer work unchanged.
 */

interface PagedDTO {
  items: InspectionDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Creates the record at the start of the capture flow. */
export async function createInspection(
  details: InspectionDetails,
): Promise<Inspection> {
  const dto = await request<InspectionDTO>('/inspections', {
    method: 'POST',
    body: {
      business: { name: details.businessName },
      location: {
        address: details.location,
        district: details.district || undefined,
        state: details.state || undefined,
        latitude: details.latitude,
        longitude: details.longitude,
        accuracyM: details.accuracyM,
      },
      productCategory: toWireCategory(details.productCategory),
      productName: details.productName || undefined,
      notes: details.inspectorNotes || undefined,
    },
  });

  return toInspection(dto);
}

export async function updateInspection(
  id: string,
  patch: Partial<InspectionDetails>,
): Promise<Inspection> {
  const body: Record<string, unknown> = {};

  if (patch.businessName) body.business = { name: patch.businessName };
  if (patch.location) {
    body.location = {
      address: patch.location,
      district: patch.district || undefined,
      state: patch.state || undefined,
      latitude: patch.latitude,
      longitude: patch.longitude,
      accuracyM: patch.accuracyM,
    };
  }
  if (patch.productCategory) body.productCategory = toWireCategory(patch.productCategory);
  if (patch.productName !== undefined) body.productName = patch.productName;
  if (patch.inspectorNotes !== undefined) body.notes = patch.inspectorNotes;

  const dto = await request<InspectionDTO>(`/inspections/${id}`, { method: 'PATCH', body });
  return toInspection(dto);
}

export async function listInspections(
  query: InspectionListQuery = {},
): Promise<InspectionListResponse> {
  const paged = await request<PagedDTO>('/inspections', {
    query: {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
      search: query.search || undefined,
      // The mobile filter is a compliance verdict; the API's status enum
      // carries the verdict values too, so it maps straight through.
      status:
        query.status && query.status !== 'all'
          ? toWireComplianceStatus(query.status as ComplianceStatus)
          : undefined,
      from: query.from,
      to: query.to,
    },
  });

  return {
    items: paged.items.map(toInspectionSummary),
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
    // Guarded so an empty result still reports one page rather than zero, which
    // would leave the pager with nothing to render and no way back.
    totalPages: Math.max(paged.totalPages, 1),
  };
}

export async function getInspection(id: string): Promise<Inspection> {
  const dto = await request<InspectionDTO>(`/inspections/${id}`);
  return toInspection(dto);
}

export async function deleteInspection(id: string): Promise<void> {
  await request(`/inspections/${id}`, { method: 'DELETE' });
}

/* ── Images ───────────────────────────────────────────────────────────────── */

/**
 * Uploads one captured image.
 *
 * Sent as multipart rather than base64 JSON: a 4 MB photograph becomes ~5.5 MB
 * base64, and the encode blocks the JS thread on a mid-range device.
 */
export async function uploadImage(
  inspectionId: string,
  image: ProductImage,
): Promise<{ imageId: string; url: string }> {
  const form = new FormData();

  const name = image.uri.split('/').pop() || `${image.side}.jpg`;
  const extension = name.split('.').pop()?.toLowerCase();
  const mimeType =
    extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';

  // React Native's FormData takes this {uri, name, type} shape.
  form.append('image', {
    uri: image.uri,
    name,
    type: mimeType,
  } as unknown as Blob);
  form.append('type', toWireSide(image.side));

  const response = await request<{
    inspectionId: string;
    images: Array<{ imageId: string; url: string }>;
  }>(`/inspections/${inspectionId}/images`, { method: 'POST', formData: form });

  const uploaded = response.images[0];
  if (!uploaded) {
    throw new ApiError('upload_failed', 'The server accepted the upload but returned no image.');
  }

  return uploaded;
}

/** Uploads every captured image, reporting progress as each completes. */
export async function uploadImages(
  inspectionId: string,
  images: ProductImage[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Array<{ localId: string; imageId: string; url: string }>> {
  const results: Array<{ localId: string; imageId: string; url: string }> = [];

  // Sequential rather than parallel: several 4 MB uploads at once on a field
  // connection is how you get a timeout instead of a faster upload.
  for (const [index, image] of images.entries()) {
    const uploaded = await uploadImage(inspectionId, image);
    results.push({ localId: image.id, ...uploaded });
    onProgress?.(index + 1, images.length);
  }

  return results;
}

export async function deleteImage(inspectionId: string, imageId: string): Promise<void> {
  await request(`/inspections/${inspectionId}/images/${imageId}`, { method: 'DELETE' });
}

/* ── Workflow ─────────────────────────────────────────────────────────────── */

export async function reviewField(
  inspectionId: string,
  fieldKey: string,
  action: ReviewAction,
  value: string | null,
  comment?: string,
): Promise<Inspection> {
  const dto = await request<InspectionDTO>(`/inspections/${inspectionId}/review`, {
    method: 'POST',
    body: {
      fieldName: fieldKey,
      action: toWireReviewAction(action),
      value: action === 'edited' ? value : undefined,
      comment,
    },
  });

  return toInspection(dto);
}

export async function finalizeInspection(
  inspectionId: string,
  finalNotes?: string,
): Promise<Inspection> {
  const dto = await request<InspectionDTO>(`/inspections/${inspectionId}/finalize`, {
    method: 'POST',
    body: { finalNotes: finalNotes || undefined },
  });

  return toInspection(dto);
}

export async function getStats(): Promise<ReportStats> {
  const stats = await request<{
    totalInspections: number;
    compliant: number;
    violations: number;
    pendingReviews: number;
    finalized: number;
    averageScore: number;
  }>('/inspections/stats');

  return {
    totalInspections: stats.totalInspections,
    compliant: stats.compliant,
    violations: stats.violations,
    pendingReviews: stats.pendingReviews,
    averageScore: stats.averageScore,
  };
}
