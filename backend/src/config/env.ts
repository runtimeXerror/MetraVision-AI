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
   * `gemini` → Gemini Flash reading the label as a vision-language model.
   *            Best recall on curved, angled and bilingual packaging, but
   *            returns no bounding boxes and no confidence — see the header of
   *            `GeminiOCRProvider` for what that costs downstream.
   * `google` → Google Cloud Vision DOCUMENT_TEXT_DETECTION. Per-word
   *            confidence and bounding polygons, so a finding can be shown on
   *            the photograph.
   * `mock`   → deterministic fixtures. Reads nothing; the CI and
   *            no-credentials default.
   *
   * A future self-hosted model is one more value and one class beside
   * `services/ocr/`. Nothing downstream of `OCRProvider` changes.
   * ────────────────────────────────────────────────────────────────────────
   */
  OCR_PROVIDER: z.enum(['mock', 'google', 'gemini']).default('mock'),

  /**
   * The Gemini model used when OCR_PROVIDER=gemini.
   *
   * Flash rather than Pro: transcription is not a reasoning task, and Flash is
   * several times cheaper and faster for the same job on printed packaging.
   */
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),

  /**
   * The API key for the selected cloud provider.
   *
   * `google`  — a Vision-enabled Google Cloud API key. Either this or
   *             GOOGLE_APPLICATION_CREDENTIALS is required; the key wins when
   *             both are set.
   * `gemini`  — a Google AI Studio key (https://aistudio.google.com/apikey).
   *             Required; there is no service-account path.
   *
   * NEVER commit a value. NEVER ship one to the mobile or web client — every
   * OCR call is made from this process precisely so the credential stays here.
   */
  OCR_API_KEY: z.string().optional(),
  /** Absolute path to a service-account JSON file, as the alternative to a key. */
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /** Comma-separated BCP-47 hints, e.g. `en,hi`. Empty lets Vision auto-detect. */
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
