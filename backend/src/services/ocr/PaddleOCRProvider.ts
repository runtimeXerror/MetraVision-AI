import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';

import type { OCRBoundingBox, OCRImageInput, OCRProvider, OCRRegion, OCRResult } from './OCRProvider';

/**
 * ── PADDLEOCR (PP-OCRv5), VIA THE LOCAL SIDECAR ─────────────────────────────
 *
 * The default provider, and the one this system is built around.
 *
 * ── Why a self-hosted model rather than a cloud API ────────────────────────
 *
 *   • **No per-scan cost and no quota.** A field pilot photographing a few
 *     thousand packages costs nothing, and a demo cannot be rate-limited into
 *     silence at the wrong moment.
 *   • **The photographs stay on the machine.** An inspection image is
 *     evidence about a named trader. Not sending it to a third party is a
 *     property worth having on its own, and it is what makes an air-gapped
 *     deployment possible at all.
 *   • **It works offline.** An inspector in a market with no signal can still
 *     complete a scan. That is the difference between a tool that is used in
 *     the field and one that is used at a desk afterwards.
 *   • **Boxes and confidences.** PP-OCRv5 returns a detection quadrilateral
 *     and a recognition score for every line. Both are load-bearing
 *     downstream: the evidence panel draws the boxes over the photograph so a
 *     finding can be checked against the package, and `DecisionEngine` reads
 *     the confidence — a check that fails on a weak reading becomes a review
 *     rather than a violation. A provider without them makes the system
 *     either blinder or more accusatory.
 *
 * ── What it costs ──────────────────────────────────────────────────────────
 *
 * A second process that has to be running, and roughly a gigabyte of RAM held
 * for the weights. On very curved or foil packaging a large vision-language
 * model still reads more of the label than PP-OCRv5 does. That is the trade
 * accepted here: slightly lower recall on hard surfaces, in exchange for
 * geometry, confidence, zero marginal cost and no third party.
 *
 * ── The seam ───────────────────────────────────────────────────────────────
 *
 * Nothing about Paddle crosses this file. The sidecar's JSON is translated
 * into `OCRResult` here, and the extractor, the adapter, the rule engine and
 * both clients continue to depend on that type and nothing else — see the
 * header of `OCRProvider.ts`.
 *
 * The service is `ocr-service/` in this repository. It is started separately:
 *
 *     ocr-service/.venv/Scripts/python -m uvicorn app:app --port 8001
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The sidecar's response shape. Confined to this file, on purpose. */
interface SidecarLine {
  text: string;
  /** Absent where the engine supplied no score — never defaulted. */
  confidence?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  polygon?: number[][];
}

interface SidecarResponse {
  success?: boolean;
  fullText?: string;
  lines?: SidecarLine[];
  metadata?: {
    imageWidth?: number;
    imageHeight?: number;
    processingTimeMs?: number;
    engine?: string;
    engineVersion?: string;
    languages?: string[];
    preprocessing?: string[];
    lowResolution?: boolean;
    lineCount?: number;
    meanConfidence?: number | null;
    minConfidence?: number | null;
  };
  error?: string;
}

interface SidecarHealth {
  ready?: boolean;
  engineVersion?: string;
}

/**
 * The engine version, learned from the sidecar at first contact.
 *
 * It is recorded on every inspection, so a finding can later be attributed to
 * the exact model that produced the reading it rests on. Cached rather than
 * fetched per scan, and it falls back to the generic name until the first
 * successful read — an unknown version must never delay a read.
 */
let observedVersion: string | undefined;

/** Test seam: forgets the version learned from a previous sidecar. */
export function resetPaddleVersionCache(): void {
  observedVersion = undefined;
}

/** `{x, y, width, height}` → the `[x1, y1, x2, y2]` the evidence layer draws. */
function toBBox(box: SidecarLine['boundingBox']): OCRBoundingBox | undefined {
  if (!box) return undefined;
  return [box.x, box.y, box.x + box.width, box.y + box.height];
}

export class PaddleOCRProvider implements OCRProvider {
  readonly name = 'paddleocr';

  get version(): string {
    return observedVersion ?? 'PP-OCRv5';
  }

  /**
   * True unconditionally — there is no credential to check.
   *
   * Whether the sidecar is *running* is deliberately not tested here.
   * `isConfigured()` is called synchronously during setup checks, reaching
   * across the network would make it a health probe, and a sidecar that is
   * momentarily down is a runtime failure with a retry, not a configuration
   * error the operator has to fix. `extractText` reports that case with a
   * message naming the command to start it.
   */
  isConfigured(): boolean {
    return true;
  }

  configurationHint(): string | null {
    return null;
  }

  /** Optional liveness probe, for a health endpoint or a startup log line. */
  async isReady(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const response = await fetch(`${env.OCR_SERVICE_URL}/health`, {
          signal: controller.signal,
        });
        if (!response.ok) return false;

        const body = (await response.json()) as SidecarHealth;
        if (body.engineVersion) observedVersion = body.engineVersion;
        return body.ready === true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  async extractText(image: OCRImageInput): Promise<OCRResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.OCR_TIMEOUT_MS);

    try {
      const form = new FormData();
      form.append(
        'image',
        new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
        `${image.imageId}`,
      );

      const response = await fetch(`${env.OCR_SERVICE_URL}/ocr`, {
        method: 'POST',
        // No Content-Type header: fetch sets the multipart boundary itself,
        // and setting it by hand produces a body the sidecar cannot parse.
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw errorFor(response.status, await safeDetail(response));
      }

      const body = (await response.json()) as SidecarResponse;

      if (body.success === false) {
        throw new ApiError(503, 'OCR_FAILED', 'The OCR service could not read this image.');
      }

      if (body.metadata?.engineVersion) observedVersion = body.metadata.engineVersion;

      const imageSize =
        body.metadata?.imageWidth && body.metadata?.imageHeight
          ? { width: body.metadata.imageWidth, height: body.metadata.imageHeight }
          : undefined;

      const regions: OCRRegion[] = (body.lines ?? [])
        .filter((entry) => typeof entry.text === 'string' && entry.text.trim() !== '')
        .map((entry) => ({
          text: entry.text,
          // Passed through exactly as the engine reported it, and left
          // undefined where it reported none. A fabricated score here would
          // turn an uncertain reading into a finding — see `DecisionEngine`.
          confidence: typeof entry.confidence === 'number' ? entry.confidence : undefined,
          boundingBox: toBBox(entry.boundingBox),
          kind: 'LINE' as const,
          imageId: image.imageId,
        }));

      // `fullText` is preferred over re-joining the regions: it is the
      // sidecar's own reading order, and the two must not diverge.
      const rawText = (body.fullText ?? regions.map((region) => region.text).join('\n')).trim();

      if (body.metadata?.lowResolution) {
        logger.warn(
          { imageId: image.imageId, width: imageSize?.width, height: imageSize?.height },
          'OCR ran on a low-resolution image; small print may not have been detected',
        );
      }

      // An empty read is a legitimate outcome — a photograph of a blank
      // surface reads as nothing — so it is passed through rather than raised
      // here. `scanService` decides what an empty read across every image
      // means, and it is the only place that can, because it is the only
      // place that knows how many images there were.
      return {
        rawText,
        regions,
        provider: this.name,
        providerVersion: this.version,
        processingTimeMs: body.metadata?.processingTimeMs ?? Date.now() - startedAt,
        imageSize,
        confidenceAvailable: regions.some((region) => typeof region.confidence === 'number'),
        languageHints: body.metadata?.languages ?? env.ocrLanguageHints,
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

      // A refused connection means the sidecar is not running, which is by
      // far the most common failure in development and on a fresh machine.
      // Naming the fix here saves an operator reading three layers of logs to
      // discover that a process is simply not up.
      if (isConnectionRefused(error)) {
        logger.error(
          { url: env.OCR_SERVICE_URL },
          'OCR sidecar is not reachable — start it with: cd ocr-service && .venv/Scripts/python -m uvicorn app:app --port 8001',
        );
        throw new ApiError(
          503,
          'OCR_SERVICE_DOWN',
          `The OCR service at ${env.OCR_SERVICE_URL} is not running. Start it and try again.`,
        );
      }

      logger.error({ err: error instanceof Error ? error.name : 'unknown' }, 'OCR request failed');
      throw new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  }
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Undici nests the OS error one level down as `cause`.
  const cause = (error as { cause?: { code?: string } }).cause;
  const code = cause?.code ?? (error as { code?: string }).code;

  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET';
}

/** The sidecar's own error text, which is written to be shown to an operator. */
async function safeDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return typeof body.error === 'string' ? body.error.slice(0, 200) : '';
  } catch {
    return '';
  }
}

function errorFor(status: number, detail: string): ApiError {
  logger.error({ status, detail }, 'OCR service returned an error');

  if (status === 413) {
    return new ApiError(
      422,
      'OCR_IMAGE_REJECTED',
      detail || 'The image is too large for the OCR service.',
    );
  }
  if (status === 400 || status === 415 || status === 422) {
    return new ApiError(
      422,
      'OCR_IMAGE_REJECTED',
      detail || 'The OCR service could not read this image. Try a clearer photograph.',
    );
  }
  // 503 from the sidecar means its engine is broken, not that the label is
  // unreadable. Kept distinct so a retry against the same photograph is the
  // obviously correct response.
  return new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.');
}
