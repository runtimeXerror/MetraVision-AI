import path from 'node:path';

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiRateLimiter } from './middleware/rateLimit';
import routes from './routes';

/**
 * Express application assembly.
 *
 * Kept free of `listen()` and of database connection so tests can mount the app
 * against an in-memory MongoDB without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy in deployment; needed for correct client IPs, which
  // the rate limiter keys on.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Uploaded images are served from this origin and rendered by the mobile
      // app, so the default same-origin embedder policy has to be relaxed.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: env.isProduction ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin: env.corsOrigins === '*' ? true : env.corsOrigins,
      credentials: true,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  /**
   * Uploaded images.
   *
   * Served before the rate limiter: a single inspection detail screen fetches
   * several images at once, and those should not consume an inspector's API
   * request budget.
   */
  app.use(
    '/uploads',
    express.static(path.resolve(env.uploadPath), {
      maxAge: env.isProduction ? '7d' : 0,
      index: false,
      dotfiles: 'ignore',
      setHeaders(res) {
        // Evidence images are inert content. Uploads are already restricted to
        // raster formats by magic-byte check, but the seeded schematic labels
        // are SVG — and an SVG served from the app's own origin can carry
        // script. These headers make anything served here unable to execute or
        // be re-interpreted as another type.
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );

  app.use('/api', apiRateLimiter, routes);

  // Root gives a human something useful when they open the URL in a browser.
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'MetraVision AI API',
        phase: 'Phase 4',
        docs: '/api/health',
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
