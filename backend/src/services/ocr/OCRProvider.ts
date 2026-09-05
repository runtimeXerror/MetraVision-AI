/**
 * ── THE OCR SEAM ────────────────────────────────────────────────────────────
 *
 * Everything downstream of this file — extraction, the rule engine, the report,
 * both clients — depends on `OCRResult` and on nothing else. No Google type, no
 * Azure envelope, no PaddleOCR tensor shape crosses this line.
 *
 * That is the whole reason the interface exists. The OCR engine is the part of
 * this system most likely to be replaced: today it is a cloud API, and the
 * benchmarking phase may well replace it with a locally hosted model. If a
 * provider's response shape leaked into the extractor, "swap the OCR" would
 * mean rewriting the extractor, the adapter and the tests. Here it means adding
 * one class and changing one environment variable.
 *
 *      OCRProvider
 *      ├── GoogleVisionOCRProvider   (cloud, current)
 *      ├── MockOCRProvider           (deterministic, tests + CI)
 *      └── <FutureLocalOCRProvider>  (a benchmarked model behind an HTTP call)
 *
 * The contract is deliberately narrow: bytes in, text and located regions out.
 * A provider decides nothing about compliance, about which field a line of text
 * belongs to, or about whether a declaration is missing. It reads.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** `[x1, y1, x2, y2]` in pixels of `OCRResult.imageSize`. */
export type OCRBoundingBox = [number, number, number, number];

/** The granularity a region was cut at. Providers report what they can. */
export const OCR_REGION_KINDS = ['BLOCK', 'PARAGRAPH', 'LINE', 'WORD'] as const;
export type OCRRegionKind = (typeof OCR_REGION_KINDS)[number];

export interface OCRRegion {
  /** Verbatim text at this location. Never cleaned up — normalisation is the extractor's job. */
  text: string;
  /**
   * 0–1, **only when the provider supplied one**. Left `undefined` otherwise,
   * and never invented: a fabricated confidence would flow into the rule
   * engine's decision policy and turn a guess into a finding.
   */
  confidence?: number;
  boundingBox?: OCRBoundingBox;
  kind?: OCRRegionKind;
  /** Which uploaded image this region was read from. */
  imageId: string;
}

export interface OCRResult {
  /** The full text of one image, with the provider's own line breaks preserved. */
  rawText: string;
  regions: OCRRegion[];
  /** Provider key, e.g. `google-vision`. Persisted on every inspection. */
  provider: string;
  /** Provider/model version, where the provider identifies one. */
  providerVersion?: string;
  processingTimeMs?: number;
  /** The frame `boundingBox` coordinates are expressed in. */
  imageSize?: { width: number; height: number };
  /** True when at least one region carried a provider-supplied confidence. */
  confidenceAvailable: boolean;
  /** Language hints the request was made with, for the audit record. */
  languageHints?: string[];
  imageId: string;
}

export interface OCRImageInput {
  /** Stable id of the stored image; becomes `EvidenceReference.imageId`. */
  imageId: string;
  buffer: Buffer;
  mimeType: string;
}

export interface OCRProvider {
  /** Stable key recorded on the inspection, e.g. `google-vision`, `mock`. */
  readonly name: string;
  readonly version: string;
  /**
   * Reads one image. Throws `ApiError` with an `OCR_*` code on failure —
   * never returns an empty result to disguise an outage, because an empty read
   * looks to the rule engine exactly like a blank package.
   */
  extractText(image: OCRImageInput): Promise<OCRResult>;
  /** False when required credentials are absent; the caller reports setup, not failure. */
  isConfigured(): boolean;
  /** One line naming what is missing, when `isConfigured()` is false. */
  configurationHint(): string | null;
}

/** One photograph the read could not account for, and why. */
export interface UnreadImage {
  imageId: string;
  /** The `OCR_*` code, so the audit record says which failure this was. */
  code: string;
  reason: string;
}

/** Merges per-image results into the one payload the extractor consumes. */
export interface AggregateOCRResult {
  provider: string;
  providerVersion?: string;
  /** Per-image texts joined by a blank line, in upload order. */
  rawText: string;
  regions: OCRRegion[];
  perImage: OCRResult[];
  processingTimeMs: number;
  confidenceAvailable: boolean;
  /**
   * Photographs that were submitted and not read.
   *
   * Carried rather than dropped, because the difference between "this package
   * declares no batch number" and "the face carrying it was never read" is the
   * difference between a finding and a bug. Everything downstream counts the
   * images in `perImage`; this is what says why that is fewer than the
   * inspector photographed.
   */
  unread: UnreadImage[];
}

export function aggregate(
  results: OCRResult[],
  processingTimeMs: number,
  unread: UnreadImage[] = [],
): AggregateOCRResult {
  const first = results[0];

  return {
    provider: first?.provider ?? 'none',
    providerVersion: first?.providerVersion,
    rawText: results.map((result) => result.rawText).filter((text) => text.trim() !== '').join('\n\n'),
    regions: results.flatMap((result) => result.regions),
    perImage: results,
    processingTimeMs,
    confidenceAvailable: results.some((result) => result.confidenceAvailable),
    unread,
  };
}
