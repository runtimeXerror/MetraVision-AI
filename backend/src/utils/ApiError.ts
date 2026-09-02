/**
 * The one error type controllers and services throw.
 *
 * `errorCode` is a stable machine-readable string the mobile app can branch on;
 * `message` is written to be shown to an inspector verbatim. Internal detail is
 * kept in `details`, which the error handler only forwards for 4xx responses.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly details?: unknown;
  /**
   * Lets `details` accompany a 5xx.
   *
   * Off by default, because the error handler's rule — internal state never
   * leaves the process — is the right default and the reason `details` is
   * dropped from a 500. Set it only where the details were written *for* the
   * client and contain nothing else: a failed scan tells the caller which
   * inspection to retry and why, and that is useful precisely when the cause
   * was a 503 from an upstream service.
   */
  readonly exposeDetails: boolean;

  constructor(
    statusCode: number,
    errorCode: string,
    message: string,
    details?: unknown,
    options: { exposeDetails?: boolean } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.exposeDetails = options.exposeDetails ?? false;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }

  static validation(details: unknown, message = 'The request contains invalid values.'): ApiError {
    return new ApiError(422, 'VALIDATION_FAILED', message, details);
  }

  static unauthorized(message = 'Authentication is required.', code = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'You do not have access to this resource.'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'The requested resource was not found.', code = 'NOT_FOUND'): ApiError {
    return new ApiError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT'): ApiError {
    return new ApiError(409, code, message);
  }

  static tooLarge(message: string): ApiError {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
  }

  static unsupportedMedia(message: string): ApiError {
    return new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
  }

  static tooManyRequests(message = 'Too many requests. Try again shortly.'): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static internal(message = 'An unexpected error occurred.', code = 'INTERNAL_ERROR'): ApiError {
    return new ApiError(500, code, message);
  }

  static serviceUnavailable(message: string, code = 'SERVICE_UNAVAILABLE'): ApiError {
    return new ApiError(503, code, message);
  }
}
