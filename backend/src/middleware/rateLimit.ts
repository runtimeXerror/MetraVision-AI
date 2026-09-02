import rateLimit from 'express-rate-limit';

import { env } from '../config/env';

/**
 * Rate limiting.
 *
 * Two tiers: ordinary API traffic is limited generously, while the credential
 * endpoints are limited tightly because they are the ones worth brute-forcing.
 * Disabled under test so a suite of a few hundred requests does not trip it.
 */

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.isTest,
  message: {
    success: false,
    message: 'Too many requests. Try again shortly.',
    errorCode: 'RATE_LIMITED',
  },
};

export const apiRateLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  limit: env.RATE_LIMIT_MAX,
});

export const authRateLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  message: {
    success: false,
    message: 'Too many sign-in attempts. Try again in a few minutes.',
    errorCode: 'RATE_LIMITED',
  },
});
