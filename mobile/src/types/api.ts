import type { AIAnalysis, Inspection, InspectionSummary, ProductImage } from './models';

/**
 * Transport-level shapes.
 *
 * These describe what `src/services/api.ts` hands back. The mock services in
 * Phase 1 and the HTTP client in Phase 2 both satisfy them, which is what lets
 * the screens stay untouched across the transition.
 */

/** Envelope every service call resolves to. */
export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

/** Discriminated union describing why a call failed. */
export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'upload_failed'
  | 'analysis_failed'
  /** Producing or saving a document failed on the device, not on the server. */
  | 'export_failed'
  | 'server'
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly details?: unknown;
  /** The backend's machine-readable code, e.g. `INSPECTION_FINALIZED`. */
  readonly code?: string;
  /** Whether the UI should offer a Retry button. */
  readonly retryable: boolean;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; details?: unknown; retryable?: boolean; code?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.details = options.details;
    this.code = options.code;
    this.retryable = options.retryable ?? RETRYABLE_KINDS.includes(kind);
  }
}

const RETRYABLE_KINDS: ApiErrorKind[] = [
  'network',
  'timeout',
  'server',
  'upload_failed',
  'analysis_failed',
  'export_failed',
];

/* ── Request payloads ─────────────────────────────────────────────────────── */

export interface LoginRequest {
  /** Email address or inspector ID — the backend accepts either. */
  identifier: string;
  password: string;
}

export interface AnalyzeRequest {
  images: ProductImage[];
  /** Optional hint; the engine still classifies independently. */
  categoryHint?: string;
  inspectionId?: string;
}

export interface AnalyzeResponse {
  analysis: AIAnalysis;
}

export interface InspectionListQuery {
  search?: string;
  status?: string;
  /** ISO date, inclusive. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface InspectionListResponse {
  items: InspectionSummary[];
  /** Records matching the filters, across every page — not the page length. */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FinalizeInspectionRequest {
  inspectionId: string;
  finalNotes?: string;
}

export interface FinalizeInspectionResponse {
  inspection: Inspection;
  reportId: string;
}

/* ── Async UI state ───────────────────────────────────────────────────────── */

/**
 * The four states every screen must be able to render. Modelling this as a
 * union rather than three loose booleans is what stops "blank screen" bugs:
 * an exhaustive switch has to handle `empty` and `error` explicitly.
 */
export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError };
