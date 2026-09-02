import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { ZodError } from 'zod';

import { env } from '../config/env';
import { logger } from '../config/logger';
import { ApiError } from '../utils/ApiError';

/** Terminal 404 — anything that fell through the router. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}.`, 'ROUTE_NOT_FOUND'));
};

/**
 * The single place an error becomes a response.
 *
 * Known failure types are translated into the standard envelope with a message
 * written for an inspector to read. Anything else is logged with its stack and
 * reported as a generic 500 — internal detail never leaves the process.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const apiError = normalise(error);

  if (apiError.statusCode >= 500) {
    logger.error(
      { err: error, method: req.method, url: req.originalUrl, userId: req.user?.id },
      apiError.message,
    );
  } else {
    logger.warn(
      { errorCode: apiError.errorCode, method: req.method, url: req.originalUrl, userId: req.user?.id },
      apiError.message,
    );
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    errorCode: apiError.errorCode,
    // Details are validation feedback the client needs; never internal state.
    // A 5xx carries them only when the thrower marked them as written for the
    // client — see `ApiError.exposeDetails`.
    ...(apiError.details && (apiError.statusCode < 500 || apiError.exposeDetails)
      ? { details: apiError.details }
      : {}),
  });
};

function normalise(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    return ApiError.validation(
      error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      Object.entries(error.errors).map(([path, err]) => ({ path, message: err.message })),
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`"${String(error.value)}" is not a valid ${error.path}.`, 'INVALID_ID');
  }

  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyValue ?? {})[0] ?? 'value';
    return ApiError.conflict(`A record with that ${field} already exists.`, 'DUPLICATE_KEY');
  }

  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return ApiError.tooLarge(`The image exceeds the ${env.MAX_UPLOAD_MB} MB upload limit.`);
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return ApiError.badRequest('Too many files in one upload.', 'UPLOAD_FAILED');
    }
    return ApiError.badRequest(`Upload failed: ${error.message}`, 'UPLOAD_FAILED');
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return ApiError.badRequest('The request body is not valid JSON.', 'MALFORMED_JSON');
  }

  return ApiError.internal();
}

interface DuplicateKeyError {
  code: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKeyError(error: unknown): error is DuplicateKeyError {
  return typeof error === 'object' && error !== null && (error as DuplicateKeyError).code === 11000;
}
