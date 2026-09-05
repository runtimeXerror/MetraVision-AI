import {
  API_BASE_URL,
  OFFLINE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  USE_MOCK_SERVICES,
} from '../constants/config';
import { useConnectivityStore } from '../store/connectivityStore';
import { ApiError, type ApiErrorKind } from '../types';

import { getRefreshToken, getToken, saveTokens } from './storage';

/**
 * The single HTTP entry point for the whole application.
 *
 * Nothing above this file constructs a URL, sets a header or reads a status
 * code. That is what made the Phase 2 cut-over a change to this file and the
 * services beside it, with no screen touched:
 *
 *     Mobile  ->  api.ts  ->  Backend (Node/Express)  ->  AI service (Phase 3)
 */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised as JSON unless `formData` is set. */
  body?: unknown;
  formData?: FormData;
  /** Appended as a query string; `undefined` and `''` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /**
   * How long to wait before aborting, in milliseconds.
   *
   * Defaults to `UPLOAD_TIMEOUT_MS` for a multipart body and
   * `REQUEST_TIMEOUT_MS` for everything else. Set it only for a call that
   * waits on real work — the scan waits on OCR and passes `SCAN_TIMEOUT_MS`.
   */
  timeoutMs?: number;
  /** Skips the Authorization header — used by login, register and refresh. */
  anonymous?: boolean;
  /** Internal: prevents a refresh loop. */
  _retried?: boolean;
}

/** The backend's success envelope. */
interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message?: string;
}

interface ErrorEnvelope {
  success: false;
  message: string;
  errorCode: string;
  details?: unknown;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  if (!query) return base;

  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return params.length > 0 ? `${base}?${params.join('&')}` : base;
}

/** Maps the backend's errorCode (and the status) onto the UI's error taxonomy. */
function kindFor(status: number, errorCode?: string): ApiErrorKind {
  switch (errorCode) {
    case 'TOKEN_EXPIRED':
    case 'TOKEN_INVALID':
    case 'REFRESH_INVALID':
    case 'REFRESH_REVOKED':
    case 'INVALID_CREDENTIALS':
    case 'ACCOUNT_INACTIVE':
      return 'unauthorized';
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'UPLOAD_FAILED':
    case 'INVALID_IMAGE':
    case 'NO_FILE':
      return 'upload_failed';
    case 'ANALYSIS_FAILED':
    // The scan pipeline's own failure code, and the one an inspector meets
    // most: it arrives as a 422 for a photograph the OCR could not read and as
    // a 503 when the OCR service is down. Without this it fell through to the
    // status check below and a failed scan was reported as a validation
    // problem with the request — which it never is.
    case 'SCAN_FAILED':
    // A scan already running on this record. Retrying is the right move: by
    // the time the inspector taps it, the first scan has finished.
    case 'SCAN_IN_PROGRESS':
      return 'analysis_failed';
    default:
      break;
  }

  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 413) return 'upload_failed';
  if (status === 415) return 'upload_failed';
  if (status === 422 || status === 400) return 'validation';
  if (status === 429) return 'server';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * Single-flight refresh.
 *
 * Several requests can fail with a 401 at once — the home screen fires three.
 * Without this they would each try to refresh, and the rotation would revoke
 * the tokens the others are using.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;

      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) return false;

      const payload = (await response.json()) as SuccessEnvelope<{
        accessToken: string;
        refreshToken: string;
        expiresAt: string;
      }>;

      await saveTokens(payload.data);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Performs one request and normalises every failure into an `ApiError`.
 *
 * Callers never see a raw fetch rejection, a non-2xx response or a JSON parse
 * error — which is what lets each screen render a meaningful state instead of a
 * blank one.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, query, signal, anonymous, timeoutMs } = options;

  // A photograph on the way up, and a scan waiting on OCR at the other end,
  // both take longer than a JSON call ever should. One flat timeout for all
  // three cancels the work of the slow two.
  const limitMs = timeoutMs ?? (formData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);

  /**
   * A much shorter leash once the app already knows the server is unreachable.
   *
   * The full twenty seconds is the right wait for a request that has a chance
   * of being answered. Spending it on the fourth call in a row from a phone
   * with no signal is how a screen that could have rendered from the cache
   * immediately instead sits on a spinner — and the officer concludes the app
   * has hung. The first failure sets the belief; every call after it fails
   * fast, and any success flips it straight back.
   *
   * Never applied to an explicit timeout or an upload: those are set by callers
   * who know what they are waiting for, and cutting a scan short mid-pipeline
   * is the failure this file already carries a long comment about.
   */
  const effectiveLimitMs =
    timeoutMs === undefined && !formData && !useConnectivityStore.getState().online
      ? Math.min(limitMs, OFFLINE_TIMEOUT_MS)
      : limitMs;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveLimitMs);
  signal?.addEventListener('abort', () => controller.abort());

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    // Never set Content-Type for FormData — the runtime must add the multipart
    // boundary itself, and an explicit header suppresses it.
    if (!formData) headers['Content-Type'] = 'application/json';

    if (!anonymous) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: controller.signal,
    });

    // The server answered. Recorded before the status is even looked at: a 401
    // or a 500 is still proof the app can reach the department's API, and it is
    // reachability — not success — that decides whether screens render live
    // data or a saved copy.
    useConnectivityStore.getState().noteReachable();

    const text = await response.text();
    const payload: unknown = text ? safeParse(text) : undefined;

    if (!response.ok) {
      const error = payload as ErrorEnvelope | undefined;
      const errorCode = error?.errorCode;

      // An expired access token is recoverable: refresh once and replay.
      const expired = response.status === 401 && errorCode !== 'INVALID_CREDENTIALS';
      if (expired && !anonymous && !options._retried) {
        const refreshed = await refreshSession();
        if (refreshed) {
          clearTimeout(timeout);
          return request<T>(path, { ...options, _retried: true });
        }
      }

      throw new ApiError(
        kindFor(response.status, errorCode),
        error?.message ?? `Request failed with status ${response.status}`,
        {
          status: response.status,
          details: error?.details,
          code: errorCode,
          // The scan endpoint states whether its failure is worth retrying —
          // an OCR outage is, a corrupted photograph is not — and it knows
          // which happened. Where it has said so, that decides whether the
          // screen offers a Retry button.
          retryable: retryableFrom(error?.details),
        },
      );
    }

    const envelope = payload as SuccessEnvelope<T> | undefined;
    return (envelope && 'data' in envelope ? envelope.data : (payload as T)) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // Nothing came back. Both branches below mean the same thing to the rest of
    // the app — the server was not reached — and that is what puts it into
    // offline mode, where every screen serves what it last saved to disk.
    //
    // A caller-supplied `signal` that aborted is the exception: that is the
    // screen cancelling its own request, not the network failing, and treating
    // it as an outage would drop a perfectly connected app into offline mode
    // every time an inspector navigated away from a loading list.
    if (!signal?.aborted) useConnectivityStore.getState().noteUnreachable();

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(
        'timeout',
        `The request timed out after ${Math.round(effectiveLimitMs / 1000)} seconds. Check your connection and try again.`,
      );
    }

    throw new ApiError(
      'network',
      'Could not reach the server. Check that the backend is running and that the API URL is correct.',
      { details: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** The backend's own verdict on whether a failure is worth retrying, if it gave one. */
function retryableFrom(details: unknown): boolean | undefined {
  if (details && typeof details === 'object' && 'retryable' in details) {
    const value = (details as { retryable?: unknown }).retryable;
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Normalises anything thrown anywhere in the app into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError('unknown', error.message, { details: error });
  return new ApiError('unknown', 'An unexpected error occurred.');
}

/** Health probe, so the profile screen can show connectivity honestly. */
export async function checkHealth(): Promise<{
  status: string;
  database: string;
  analysisProvider: string;
  phase: string;
}> {
  return request('/health', { anonymous: true });
}

/** Lets the profile screen show which mode the app is running in. */
export const apiInfo = {
  baseUrl: API_BASE_URL,
  mockMode: USE_MOCK_SERVICES,
} as const;
