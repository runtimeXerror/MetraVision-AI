import type {
  ComplianceEvaluationRequest,
  EvidenceContext,
  ExtractedField,
  ProductContext,
} from '../../compliance/types/Evidence';
import { env } from '../../config/env';
import type { ContextSignal, ExtractionResult } from '../extraction';
import type { AggregateOCRResult } from '../ocr';

/**
 * ── THE ADAPTER ─────────────────────────────────────────────────────────────
 *
 *      OCR extraction  →  ComplianceInputAdapter  →  existing rule engine
 *
 * The rule engine's input contract was written before any of this existed and
 * deliberately mentions neither OCR nor images — see the header of
 * `compliance/types/Evidence.ts`. This file is the only thing that knows both
 * shapes, and it is the reason the engine did not have to change to accept a
 * photograph.
 *
 * Two rules govern everything here.
 *
 * The adapter translates; it does not decide. It maps a field the extractor
 * found onto the field name a rule names. It does not conclude that a package
 * is compliant, that a declaration is missing, or that a rule applies. Every
 * one of those is the engine's, and moving any of them up here to make the
 * plumbing tidier would be moving legal reasoning out of the rulebook.
 *
 * It is honest about absence. A field extraction did not find is passed on as
 * `NOT_FOUND` with no `absenceConfidence` at all, so the engine falls back to
 * its own policy — how completely the package was photographed — rather than to
 * a number this layer made up. That fallback is what stops "the camera only saw
 * the front" from being recorded as "the package has no MRP".
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ScanProductContext extends ProductContext {
  /**
   * Overrides the derived value. Supplied by a client that knows how much of
   * the package it captured better than an image count can say.
   */
  captureCompleteness?: number;
}

export interface AdapterInput {
  inspectionId?: string;
  /** ISO date. Every rule and exception is resolved against this alone. */
  inspectionDate: string;
  /** What the caller told us about the package. Always outranks an inference. */
  productContext: ScanProductContext;
  extraction: ExtractionResult;
  ocr: AggregateOCRResult;
  imageIds: string[];
  /**
   * The photographs behind those ids, with the panel each one shows.
   *
   * Optional so a caller that has only ids still works; without it every
   * photograph is treated as a face of its own, which is what the ids alone
   * can support.
   */
  images?: Array<{ imageId: string; face?: string }>;
}

export interface AdapterOutput {
  request: ComplianceEvaluationRequest;
  /** Signals actually adopted, with their basis, for the report and the UI. */
  appliedSignals: ContextSignal[];
  /** Signals the caller's own context overrode. Recorded, never silently dropped. */
  overriddenSignals: ContextSignal[];
  captureCompleteness: number;
}

/**
 * How completely a package is taken to have been captured, from the number of
 * distinct faces photographed.
 *
 * A crude proxy for a real thing: a package has six faces, and a declaration
 * cannot be missing from one nobody photographed. The ladder is configuration
 * (`CAPTURE_COMPLETENESS_BY_IMAGE_COUNT`) because it is an evidentiary policy
 * rather than law, and a department that wants a stricter or looser standard
 * should be able to set one without a code change.
 *
 * The default first rung is 0.45 — below the engine's 0.7 floor — which means a
 * single-face scan can never record a missing declaration as a violation. That
 * is the intended behaviour, not a limitation: one photograph of the front face
 * is not evidence about the back.
 *
 * Faces, and not photographs, because those two come apart in exactly the case
 * that matters. An inspector photographing a small cylindrical bottle takes
 * three or four goes at the *same* panel, trying to get the curve in focus —
 * and counted as photographs that reached 0.85, past the 0.7 floor, and every
 * declaration printed on a face nobody had photographed was recorded as a
 * violation rather than sent for review. Three attempts at one panel is one
 * face of evidence, and the ladder now reads it as one.
 */
export function captureCompletenessFor(faceCount: number): number {
  const ladder = env.captureCompletenessLadder;
  if (ladder.length === 0) return 0;
  if (faceCount <= 0) return 0;
  return ladder[Math.min(faceCount, ladder.length) - 1] ?? 0;
}

/**
 * The distinct faces among a set of photographs.
 *
 * An untyped photograph counts as its own face: the capture flow records which
 * panel the inspector was shooting, and where it did not, assuming two
 * photographs are of the same face would understate the evidence just as badly
 * as assuming they differ overstates it.
 */
function facesOf(images: Array<{ imageId: string; face?: string }>): string[] {
  const seen = new Map<string, string>();

  for (const image of images) {
    const face = image.face?.trim().toUpperCase();
    seen.set(face && face !== '' ? face : `image:${image.imageId}`, face ?? 'UNSPECIFIED');
  }

  return [...seen.keys()];
}

/** Context keys an extraction signal is allowed to set. */
const ADOPTABLE = new Set<keyof ProductContext>([
  'isImported',
  'countryOfOrigin',
  'quantity',
  'quantityUnit',
  'isFoodArticle',
]);

export function toComplianceRequest(input: AdapterInput): AdapterOutput {
  const { extraction, productContext } = input;

  const fields: Record<string, ExtractedField> = {};
  const declaredElsewhere = new Set(extraction.declaredElsewhere ?? []);

  for (const record of Object.values(extraction.fields)) {
    if (record.status === 'FOUND') {
      fields[record.field] = {
        value: record.value,
        // Absent when the provider gave none. The engine reads a missing
        // confidence as "unknown reliability" and routes to review, which is
        // the right answer and the reason it is not defaulted to a number here.
        ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
        status: 'FOUND',
        ...(record.unit ? { unit: record.unit } : {}),
        evidence: record.evidence,
      };
      continue;
    }

    /**
     * Not found — but the package said where it is.
     *
     * `For MRP, refer to the carton` is not silence about the MRP; it is the
     * package telling an inspector that this tube is not the retail unit and
     * the price is on the box it came in. Zero absence confidence is the
     * strongest thing this contract can say about that, and it is what stops
     * the engine recording a violation on a declaration the label has
     * positively located elsewhere.
     */
    if (declaredElsewhere.has(record.field)) {
      fields[record.field] = {
        value: null,
        status: 'NOT_FOUND',
        absenceConfidence: 0,
        evidence: [],
      };
      continue;
    }

    /**
     * Not found, and nothing said otherwise.
     *
     * `absenceConfidence` is deliberately omitted rather than set to zero or to
     * a guess. Omitted, the engine falls back to `captureCompleteness`; set, it
     * would be this layer asserting how sure it is that a declaration is not on
     * a package it never saw.
     */
    fields[record.field] = {
      value: null,
      status: 'NOT_FOUND',
      evidence: [],
    };
  }

  /* ── Context: caller first, inference second ──────────────────────────── */

  const context: ProductContext = { ...productContext };
  delete (context as ScanProductContext).captureCompleteness;

  const appliedSignals: ContextSignal[] = [];
  const overriddenSignals: ContextSignal[] = [];

  /**
   * The category, where the caller did not state one.
   *
   * It decides which rules reach the package at all, so the order matters: an
   * inspector standing in front of the shelf outranks a word matched in a
   * vocabulary, and the inference is recorded either way so the disagreement
   * is visible on the report rather than resolved in silence.
   */
  if (extraction.category) {
    const signal: ContextSignal = {
      key: 'category',
      value: extraction.category.value,
      basis: `Classified from the commodity name printed on the package (confidence ${extraction.category.confidence.toFixed(2)}).`,
      // The same words the commodity name was read from — an inspector asking
      // why this package was put under these rules gets shown the noun.
      evidence: extraction.fields.commodity_name?.evidence ?? [],
    };

    if (context.category === undefined || context.category === '') {
      context.category = extraction.category.value;
      appliedSignals.push(signal);
    } else if (context.category !== extraction.category.value) {
      overriddenSignals.push(signal);
    }
  }

  for (const signal of extraction.contextSignals) {
    const key = signal.key as keyof ProductContext;
    if (!ADOPTABLE.has(key)) continue;

    if (productContext[key] !== undefined) {
      // The caller said otherwise. Their statement stands — an inspector
      // standing in front of the package knows more than a line of OCR — and
      // the inference is kept so the disagreement is visible.
      overriddenSignals.push(signal);
      continue;
    }

    (context as Record<string, unknown>)[key] = signal.value;
    appliedSignals.push(signal);
  }

  const faces = facesOf(input.images ?? input.imageIds.map((imageId) => ({ imageId })));

  const captureCompleteness =
    productContext.captureCompleteness ?? captureCompletenessFor(faces.length);

  const evidence: EvidenceContext = {
    imageIds: input.imageIds,
    captureCompleteness,
    facesCaptured: faces,
    extractionEngine: `${input.ocr.provider}+${extraction.engine}`,
    extractionEngineVersion: `${input.ocr.providerVersion ?? 'unknown'}+${extraction.engineVersion}`,
  };

  return {
    request: {
      inspectionId: input.inspectionId,
      inspectionDate: input.inspectionDate,
      productContext: context,
      fields,
      evidence,
    },
    appliedSignals,
    overriddenSignals,
    captureCompleteness,
  };
}
