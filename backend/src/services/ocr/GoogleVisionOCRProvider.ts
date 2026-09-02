import { readFileSync } from 'node:fs';

import jwt from 'jsonwebtoken';

import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';

import type { OCRBoundingBox, OCRImageInput, OCRProvider, OCRRegion, OCRResult } from './OCRProvider';

/**
 * ── GOOGLE CLOUD VISION ─────────────────────────────────────────────────────
 *
 * Why this provider was chosen for the MVP — written down so a later phase can
 * re-open the decision rather than inherit it:
 *
 *   • Printed packaging text is exactly what DOCUMENT_TEXT_DETECTION is tuned
 *     for: dense, small, multi-column label copy photographed at an angle,
 *     which is where plain TEXT_DETECTION and most off-the-shelf models fall
 *     apart.
 *   • Indian packages are bilingual in practice. Vision auto-detects and reads
 *     Devanagari, Tamil, Telugu, Bengali and Latin in one pass, so a Hindi
 *     "अधिकतम खुदरा मूल्य" beside an English "MRP" both reach the extractor.
 *   • It returns a word-level confidence and a bounding polygon for every
 *     token. Both are load-bearing here — the rule engine's decision policy
 *     consumes confidence, and the inspector's evidence panel consumes the
 *     boxes. A provider that returned only a string would force us to invent
 *     the first and do without the second.
 *   • Plain REST with an API key. No SDK, no native binary, no gRPC — which
 *     keeps the container small and the deployment story boring.
 *   • ~1–2 s for a 2 MP label, and the first 1,000 units a month are free, so a
 *     field pilot costs nothing and a demo cannot be rate-limited into silence.
 *
 * What it is not is permanent. It is a network dependency with a per-unit price
 * that sends label photographs to a third party. That is precisely why it sits
 * behind `OCRProvider` and why nothing downstream imports this file.
 * ────────────────────────────────────────────────────────────────────────────
 */

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/* ── Google's response shape. Confined to this file, on purpose. ──────────── */

interface Vertex {
  x?: number;
  y?: number;
}

interface BoundingPoly {
  vertices?: Vertex[];
  normalizedVertices?: Vertex[];
}

interface VisionSymbol {
  text?: string;
  confidence?: number;
  property?: { detectedBreak?: { type?: string } };
}

interface VisionWord {
  symbols?: VisionSymbol[];
  confidence?: number;
  boundingBox?: BoundingPoly;
}

interface VisionParagraph {
  words?: VisionWord[];
  confidence?: number;
  boundingBox?: BoundingPoly;
}

interface VisionBlock {
  paragraphs?: VisionParagraph[];
  confidence?: number;
  boundingBox?: BoundingPoly;
}

interface VisionPage {
  blocks?: VisionBlock[];
  width?: number;
  height?: number;
}

interface AnnotateResponse {
  responses?: Array<{
    fullTextAnnotation?: { text?: string; pages?: VisionPage[] };
    textAnnotations?: Array<{ description?: string; boundingPoly?: BoundingPoly }>;
    error?: { code?: number; message?: string; status?: string };
  }>;
  error?: { code?: number; message?: string; status?: string };
}

/* ── Service-account access tokens ────────────────────────────────────────── */

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

let cachedToken: { value: string; expiresAt: number } | undefined;

function readServiceAccount(): ServiceAccount | null {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) return null;

  try {
    const raw = readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    return { clientEmail: parsed.client_email, privateKey: parsed.private_key };
  } catch {
    // Never log the contents — the file holds a private key.
    logger.error(
      { path: env.GOOGLE_APPLICATION_CREDENTIALS },
      'GOOGLE_APPLICATION_CREDENTIALS could not be read as a service-account JSON file',
    );
    return null;
  }
}

/**
 * Exchanges the service account for an OAuth access token, cached until a
 * minute before it expires.
 *
 * Written by hand rather than by pulling in `google-auth-library`, because the
 * whole of it is a signed JWT and a form post, and that dependency would be the
 * largest thing in the image for the sake of forty lines.
 */
async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const assertion = jwt.sign({ scope: SCOPE }, account.privateKey, {
    algorithm: 'RS256',
    issuer: account.clientEmail,
    subject: account.clientEmail,
    audience: TOKEN_ENDPOINT,
    expiresIn: '1h',
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new ApiError(
      503,
      'OCR_AUTH_FAILED',
      'The OCR service could not be authenticated. Check the configured Google credentials.',
    );
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new ApiError(503, 'OCR_AUTH_FAILED', 'The OCR service returned no access token.');
  }

  cachedToken = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
  return cachedToken.value;
}

/** Test seam: drops the cached token so a credential change is picked up. */
export function resetGoogleTokenCache(): void {
  cachedToken = undefined;
}

/* ── Geometry ─────────────────────────────────────────────────────────────── */

function toBBox(
  poly: BoundingPoly | undefined,
  size: { width: number; height: number } | undefined,
): OCRBoundingBox | undefined {
  const vertices = poly?.vertices?.length
    ? poly.vertices.map((vertex) => ({ x: vertex.x ?? 0, y: vertex.y ?? 0 }))
    : poly?.normalizedVertices?.length && size
      ? poly.normalizedVertices.map((vertex) => ({
          x: Math.round((vertex.x ?? 0) * size.width),
          y: Math.round((vertex.y ?? 0) * size.height),
        }))
      : undefined;

  if (!vertices || vertices.length === 0) return undefined;

  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);

  // Vision returns a quadrilateral, which for rotated text is not axis-aligned.
  // The enclosing rectangle is what a highlight overlay can actually draw.
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Union of two boxes, for assembling a line out of its words. */
function union(
  a: OCRBoundingBox | undefined,
  b: OCRBoundingBox | undefined,
): OCRBoundingBox | undefined {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

const LINE_BREAKS = new Set(['LINE_BREAK', 'EOL_SURE_SPACE']);

/**
 * Turns Vision's block → paragraph → word → symbol tree into lines.
 *
 * Lines, rather than words or paragraphs, because a label declaration *is* a
 * line: "MRP ₹120 (incl. of all taxes)" is one unit of meaning, and both the
 * label/value patterns in the extractor and the evidence box an inspector taps
 * want that whole unit. Words fragment it; paragraphs glue unrelated
 * declarations together.
 */
function linesFrom(
  pages: VisionPage[],
  imageId: string,
  size: { width: number; height: number } | undefined,
): OCRRegion[] {
  const regions: OCRRegion[] = [];

  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        let text = '';
        let bbox: OCRBoundingBox | undefined;
        let confidenceSum = 0;
        let confidenceCount = 0;

        const flush = (): void => {
          const trimmed = text.trim();
          if (trimmed !== '') {
            regions.push({
              text: trimmed,
              // Reported only when Vision actually supplied word confidences.
              confidence: confidenceCount > 0 ? confidenceSum / confidenceCount : undefined,
              boundingBox: bbox,
              kind: 'LINE',
              imageId,
            });
          }
          text = '';
          bbox = undefined;
          confidenceSum = 0;
          confidenceCount = 0;
        };

        for (const word of paragraph.words ?? []) {
          text += (word.symbols ?? []).map((symbol) => symbol.text ?? '').join('');
          bbox = union(bbox, toBBox(word.boundingBox, size));

          if (typeof word.confidence === 'number') {
            confidenceSum += word.confidence;
            confidenceCount += 1;
          }

          const lastBreak = word.symbols?.[word.symbols.length - 1]?.property?.detectedBreak?.type;
          if (lastBreak && LINE_BREAKS.has(lastBreak)) {
            flush();
          } else {
            text += ' ';
          }
        }

        flush();
      }
    }
  }

  return regions;
}

/* ── The provider ─────────────────────────────────────────────────────────── */

export class GoogleVisionOCRProvider implements OCRProvider {
  readonly name = 'google-vision';
  readonly version = 'vision-v1/DOCUMENT_TEXT_DETECTION';

  isConfigured(): boolean {
    return Boolean(env.OCR_API_KEY) || readServiceAccount() !== null;
  }

  configurationHint(): string | null {
    if (this.isConfigured()) return null;
    return 'Google Cloud Vision needs either OCR_API_KEY (a Vision-enabled API key) or GOOGLE_APPLICATION_CREDENTIALS (a path to a service-account JSON file). See backend/.env.example.';
  }

  async extractText(image: OCRImageInput): Promise<OCRResult> {
    const hint = this.configurationHint();
    if (hint) {
      // A setup problem, not a runtime failure. Kept distinct so an operator
      // reads "you have not configured this" rather than "the API is down".
      throw new ApiError(503, 'OCR_NOT_CONFIGURED', hint);
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.OCR_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let url = VISION_ENDPOINT;

      if (env.OCR_API_KEY) {
        url = `${VISION_ENDPOINT}?key=${encodeURIComponent(env.OCR_API_KEY)}`;
      } else {
        headers.Authorization = `Bearer ${await accessToken(readServiceAccount()!)}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          requests: [
            {
              image: { content: image.buffer.toString('base64') },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
              imageContext: { languageHints: env.ocrLanguageHints },
            },
          ],
        }),
      });

      if (!response.ok) {
        throw errorFor(response.status, await safeText(response));
      }

      const body = (await response.json()) as AnnotateResponse;
      const first = body.responses?.[0];

      if (body.error ?? first?.error) {
        const detail = body.error ?? first?.error;
        throw errorFor(detail?.code ?? 500, detail?.message ?? 'unknown');
      }

      const annotation = first?.fullTextAnnotation;
      const page = annotation?.pages?.[0];
      const imageSize =
        page?.width && page?.height ? { width: page.width, height: page.height } : undefined;

      let regions = linesFrom(annotation?.pages ?? [], image.imageId, imageSize);

      // Fallback for a response carrying only `textAnnotations` — its first
      // entry is the whole page, so the located words start at index 1.
      if (regions.length === 0 && first?.textAnnotations && first.textAnnotations.length > 1) {
        regions = first.textAnnotations.slice(1).map((entry) => ({
          text: entry.description ?? '',
          boundingBox: toBBox(entry.boundingPoly, imageSize),
          kind: 'WORD' as const,
          imageId: image.imageId,
        }));
      }

      const rawText = annotation?.text ?? first?.textAnnotations?.[0]?.description ?? '';

      // An empty read is a legitimate outcome — a photograph of a blank surface
      // reads as nothing — so it is passed through rather than raised here.
      // `scanService` decides what an empty read across every image means.
      return {
        rawText,
        regions,
        provider: this.name,
        providerVersion: this.version,
        processingTimeMs: Date.now() - startedAt,
        imageSize,
        confidenceAvailable: regions.some((region) => typeof region.confidence === 'number'),
        languageHints: env.ocrLanguageHints,
        imageId: image.imageId,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(
          504,
          'OCR_TIMEOUT',
          `The OCR service did not respond within ${Math.round(env.OCR_TIMEOUT_MS / 1000)} seconds. Please try again.`,
        );
      }

      // Only the error's name is logged: its message can carry the request URL,
      // and the request URL carries the API key.
      logger.error(
        { err: error instanceof Error ? error.name : 'unknown' },
        'Google Vision request failed',
      );
      throw new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Never let a Google error body reach a user — it can echo the request URL. */
async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return '';
  }
}

function errorFor(status: number, detail: string): ApiError {
  logger.error({ status, detail }, 'Google Vision returned an error');

  if (status === 401 || status === 403) {
    return new ApiError(
      503,
      'OCR_AUTH_FAILED',
      'The OCR service rejected the configured credentials. Check the API key or service account.',
    );
  }
  if (status === 429 || status === 8) {
    return new ApiError(
      503,
      'OCR_QUOTA_EXCEEDED',
      'The OCR service quota has been exhausted. Please try again later.',
    );
  }
  if (status === 400 || status === 3) {
    return new ApiError(
      422,
      'OCR_IMAGE_REJECTED',
      'The OCR service could not read this image. Try a clearer photograph.',
    );
  }
  return new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.');
}
