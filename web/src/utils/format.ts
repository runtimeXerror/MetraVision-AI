import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

import type { ComplianceStatus, InspectionStatus, ProductCategory, Severity } from '@/types/api';

/** Display helpers. Pure, so they can be used in a render without a hook. */

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const date = parseISO(iso);
  return isValid(date) ? format(date, 'd MMM yyyy') : '—';
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const date = parseISO(iso);
  return isValid(date) ? format(date, 'd MMM yyyy, HH:mm') : '—';
}

/**
 * Date and time as two strings.
 *
 * A register row that must hold "31 Aug 2026, 14:57" on one line spends 120px
 * on a timestamp; stacked, the same fact costs the width of the date alone.
 */
export function formatDateParts(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return { date: '—', time: '' };
  return { date: format(parsed, 'd MMM yyyy'), time: format(parsed, 'HH:mm') };
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return 'No activity';
  const date = parseISO(iso);
  return isValid(date) ? `${formatDistanceToNow(date)} ago` : 'No activity';
}

/** For chart axes, where the year is redundant and space is scarce. */
export function formatAxisDate(iso: string): string {
  const date = parseISO(iso);
  return isValid(date) ? format(date, 'd MMM') : iso;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A confidence of 0.96 reads as 96%. */
export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export const categoryLabels: Record<ProductCategory, string> = {
  packaged_food: 'Packaged Food',
  beverage: 'Beverages',
  cosmetic: 'Cosmetics',
  household: 'Household',
  apparel: 'Apparel',
  electronics: 'Electronics',
  medical_device: 'Medical Devices',
  other: 'Other',
};

export function categoryLabel(category?: string): string {
  return category ? (categoryLabels[category as ProductCategory] ?? category) : '—';
}

export const statusLabels: Record<InspectionStatus, string> = {
  DRAFT: 'Draft',
  PROCESSING: 'Processing',
  REVIEW_REQUIRED: 'Review Required',
  COMPLIANT: 'Compliant',
  VIOLATION_DETECTED: 'Violation Detected',
  FINALIZED: 'Finalized',
};

export function statusLabel(status?: string): string {
  return status ? (statusLabels[status as InspectionStatus] ?? status) : '—';
}

export const complianceLabels: Record<ComplianceStatus, string> = {
  COMPLIANT: 'Compliant',
  VIOLATION_DETECTED: 'Violation Detected',
  REVIEW_REQUIRED: 'Review Required',
};

export const severityLabels: Record<Severity, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
};

/** `MISSING_DECLARATION` → `Missing Declaration`. */
export function humanise(value?: string | null): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Two-letter monogram for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
