import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Environment is validated once at boot. A missing or malformed variable fails
 * fast with a readable message rather than surfacing as an undefined three
 * layers deep at request time.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  /**
   * Mongo connection string. Leave it empty in development and the server
   * starts an in-process MongoDB via `mongodb-memory-server` — that is what
   * makes `npm run dev` work on a machine with nothing installed, which
   * matters on demo day. In production a missing URI is a hard failure.
   */
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().default('sih26034'),

  JWT_ACCESS_SECRET: z.string().min(16).default('sih26034-dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('sih26034-dev-refresh-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('2h'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  /** Comma-separated origins, or `*` during local development. */
  CORS_ORIGINS: z.string().default('*'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(12),

  /**
   * Storage backend for inspection images.
   * `local` writes to UPLOAD_DIR. The provider interface exists so S3,
   * Cloudinary or GCS can be added without touching a controller.
   */
  STORAGE_PROVIDER: z.enum(['local']).default('local'),

  /**
   * ── ANALYSIS SWITCH ─────────────────────────────────────────────────────
   * `mock` → deterministic MockAnalysisProvider (Phase 2, current)
   * `http` → HttpAnalysisProvider pointed at AI_SERVICE_URL (Phase 3)
   * Flipping this variable is the entire integration step for real OCR.
   * ────────────────────────────────────────────────────────────────────────
   */
  ANALYSIS_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  AI_SERVICE_URL: z.string().default('http://localhost:8000'),
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().default(20_000),

  /** Artificial delay so the mobile "Analysing" state is visible in a demo. */
  MOCK_ANALYSIS_DELAY_MS: z.coerce.number().default(1200),

  /**
   * ── OCR SWITCH ──────────────────────────────────────────────────────────
   * `paddle` → PP-OCRv5 running locally in the `ocr-service/` sidecar. Boxes
   *            and per-line confidence, no per-scan cost, no network, and the
   *            photographs never leave the machine. The default, and what the
   *            system is built around — see `PaddleOCRProvider`.
   * `google` → Google Cloud Vision DOCUMENT_TEXT_DETECTION. Also returns
   *            confidence and polygons; kept as the cloud comparison and as a
   *            fallback where the sidecar cannot be deployed.
   * `mock`   → deterministic fixtures. Reads nothing; the CI and
   *            no-dependencies default.
   *
   * Another engine is one more value here and one class beside
   * `services/ocr/`. Nothing downstream of `OCRProvider` changes.
   * ────────────────────────────────────────────────────────────────────────
   */
  OCR_PROVIDER: z.enum(['mock', 'paddle', 'google']).default('paddle'),

  /**
   * Where the PaddleOCR sidecar is listening, when OCR_PROVIDER=paddle.
   *
   * Localhost by default because the service holds inspection photographs in
   * memory and has no authentication of its own — it is meant to sit behind
   * the backend on the same host, not to be exposed. Pointing this at another
   * machine means putting a network boundary in front of the evidence, and
   * that boundary has to be secured separately.
   */
  OCR_SERVICE_URL: z.string().default('http://localhost:8001'),

  /**
   * The API key for the cloud provider, when OCR_PROVIDER=google.
   *
   * A Vision-enabled Google Cloud API key. Either this or
   * GOOGLE_APPLICATION_CREDENTIALS is required; the key wins when both are
   * set. Not needed at all by the default `paddle` provider.
   *
   * NEVER commit a value. NEVER ship one to the mobile or web client — every
   * OCR call is made from this process precisely so the credential stays here.
   */
  OCR_API_KEY: z.string().optional(),
  /** Absolute path to a service-account JSON file, as the alternative to a key. */
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  /**
   * Per-image OCR budget.
   *
   * A clean 2 MP label reads in 1–3s on a CPU, and 20s was set against that.
   * It is the wrong measurement: the sidecar reads a *difficult* image more
   * than once — contrast, sharpen, upscale, and rotation past that — and those
   * are exactly the photographs an inspector takes of a curved bottle or a
   * dark MRP box. Measured on this project's own photographs, a clean face
   * reads in 2–4s and a face that triggers the extra passes takes 23–27s, so
   * 20s cut off precisely the images the extra passes exist to rescue.
   *
   * 45s covers the worst of those with room for the model load the first
   * request after start pays. It is a ceiling, not a cost: a scan of clean
   * faces is no slower for it, and `OCR_BUDGET_MS` in `scanService` bounds
   * what every image together may take.
   */
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  /** Comma-separated BCP-47 hints, e.g. `en,hi`. Used by the Vision provider. */
  OCR_LANGUAGE_HINTS: z.string().default('en,hi'),
  /** Pins the mock provider to one fixture. Empty rotates by image content. */
  OCR_MOCK_FIXTURE: z.string().default(''),
  /** Visible processing time for the mock provider during a demo. */
  MOCK_OCR_DELAY_MS: z.coerce.number().nonnegative().default(600),

  /**
   * How completely one, two, three or four-plus photographs are taken to have
   * captured a package, as a 0–1 score fed to the rule engine.
   *
   * This is an evidentiary policy and not law, which is why it is
   * configuration. It matters because the engine will not record a missing
   * declaration as a violation unless the package was captured well enough for
   * its absence to mean something — a single photograph of the front face
   * cannot establish that there is no MRP on the back. See §16 of the brief
   * and `DecisionEngine.absenceStrength`.
   */
  CAPTURE_COMPLETENESS_BY_IMAGE_COUNT: z.string().default('0.45,0.7,0.85,0.95'),

  /**
   * Seed demo data on boot when the database is empty. Essential for the
   * in-memory fallback, where a separate seed process would own a different
   * database than the server. Never runs against a populated database.
   */
  AUTO_SEED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  RATE_LIMIT_WINDOW_MIN: z.coerce.number().default(15),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  /** Login is rate-limited far more tightly than ordinary traffic. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const values = parsed.data;

export const env = {
  ...values,
  isProduction: values.NODE_ENV === 'production',
  isTest: values.NODE_ENV === 'test',
  isDevelopment: values.NODE_ENV === 'development',
  /** Absolute path to the upload directory. */
  uploadPath: path.resolve(process.cwd(), values.UPLOAD_DIR),
  maxUploadBytes: values.MAX_UPLOAD_MB * 1024 * 1024,
  corsOrigins:
    values.CORS_ORIGINS === '*'
      ? ('*' as const)
      : values.CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
  /** `OCR_LANGUAGE_HINTS` as a list; `undefined` lets the provider auto-detect. */
  ocrLanguageHints: values.OCR_LANGUAGE_HINTS.split(',')
    .map((hint) => hint.trim())
    .filter(Boolean),
  /** `CAPTURE_COMPLETENESS_BY_IMAGE_COUNT` parsed, index 0 = one image. */
  captureCompletenessLadder: values.CAPTURE_COMPLETENESS_BY_IMAGE_COUNT.split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1),
} as const;

export type Env = typeof env;
