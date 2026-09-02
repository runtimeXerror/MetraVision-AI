import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { clearSession, readSession, writeTokens } from './session';

/**
 * The one HTTP client.
 *
 * Nothing above this file constructs a URL, sets a header or reads a status
 * code — every service goes through `get`/`post`/`patch`/`del`, and every
 * component goes through a service. That is what makes the auth header, the
 * response envelope and the token refresh single pieces of code rather than
 * something re-implemented per call site.
 */

/**
 * Base URL.
 *
 * Empty in development: the Vite dev server proxies `/api` to the backend, so
 * the browser talks to its own origin and there is no CORS to configure. A
 * deployed build sets `VITE_API_URL` to the real host.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(
  /\/$/,
  '',
) ?? '/api';

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

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'server'
  | 'unknown';

/**
 * Every failure the app can see, normalised.
 *
 * Components switch on `kind` to decide whether to offer a retry, so a raw
 * Axios rejection must never escape this module.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }

  /** Whether offering a Retry button makes sense. */
  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'server' ||
      this.kind === 'rate_limited'
    );
  }
}

function kindFor(status: number | undefined, code?: string): ApiErrorKind {
  switch (code) {
    case 'TOKEN_EXPIRED':
    case 'TOKEN_INVALID':
    case 'REFRESH_INVALID':
    case 'REFRESH_REVOKED':
    case 'INVALID_CREDENTIALS':
    case 'ACCOUNT_INACTIVE':
    case 'ACCOUNT_NOT_FOUND':
      return 'unauthorized';
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'RATE_LIMITED':
      return 'rate_limited';
    default:
      break;
  }

  if (status === undefined) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  // Retryable, but only after a pause — never immediately, which is what an
  // un-classified 429 would get from the retry policy.
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: { Accept: 'application/json' },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const session = readSession();
  if (session?.accessToken && !config.headers.has('Authorization')) {
    config.headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  return config;
});

/**
 * Single-flight refresh.
 *
 * The dashboard opens several queries at once, so an expired token produces a
 * burst of 401s. Without this they would each try to refresh, and the backend's
 * token rotation would revoke the refresh token the others are still using —
 * signing the supervisor out precisely when the session was recoverable.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const session = readSession();
      if (!session?.refreshToken) return false;

      // A bare axios call, not `http`: the interceptor would attach the very
      // access token that has just been rejected.
      const response = await axios.post<SuccessEnvelope<{
        accessToken: string;
        refreshToken: string;
        expiresAt: string;
      }>>(
        `${API_BASE_URL}/auth/refresh`,
        { refreshToken: session.refreshToken },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 },
      );

      writeTokens(response.data.data);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Called when a session cannot be recovered, so the app can route to /login. */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

type RetriableConfig = AxiosRequestConfig & { _retried?: boolean };

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ErrorEnvelope>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const envelope = error.response?.data;
    const code = envelope?.errorCode;

    if (error.code === 'ECONNABORTED') {
      throw new ApiError('timeout', 'The server took too long to respond. Try again.');
    }

    // An expired access token is recoverable: refresh once, then replay.
    const recoverable =
      status === 401 && code !== 'INVALID_CREDENTIALS' && config && !config._retried;

    if (recoverable) {
      const refreshed = await refreshSession();
      if (refreshed) {
        config._retried = true;
        return http.request(config);
      }
      clearSession();
      onSessionLost?.();
    }

    if (!error.response) {
      throw new ApiError(
        'network',
        'Could not reach the server. Check that the backend is running.',
        { details: error.message },
      );
    }

    throw new ApiError(kindFor(status, code), envelope?.message ?? 'The request failed.', {
      status,
      code,
      details: envelope?.details,
    });
  },
);

/** Unwraps the success envelope so services return the payload directly. */
async function unwrap<T>(promise: Promise<{ data: SuccessEnvelope<T> | T }>): Promise<T> {
  const response = await promise;
  const body = response.data as SuccessEnvelope<T> & T;
  return body && typeof body === 'object' && 'data' in body && 'success' in body
    ? (body.data as T)
    : (body as T);
}

export function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return unwrap<T>(http.get(url, { params: clean(params) }));
}

export function post<T>(url: string, body?: unknown): Promise<T> {
  return unwrap<T>(http.post(url, body));
}

export function patch<T>(url: string, body?: unknown): Promise<T> {
  return unwrap<T>(http.patch(url, body));
}

export function del<T>(url: string): Promise<T> {
  return unwrap<T>(http.delete(url));
}

/**
 * Drops empty query parameters.
 *
 * A filter cleared in the UI becomes `undefined` or `''`; sending it would make
 * the backend validate an empty enum and reject the whole request.
 */
function clean(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== '' && value !== 'ALL',
    ),
  );
}

/** Normalises anything thrown anywhere into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError('unknown', error.message);
  return new ApiError('unknown', 'An unexpected error occurred.');
}
