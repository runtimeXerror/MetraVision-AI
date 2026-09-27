import type { EvidenceReference } from '../../compliance/types/Evidence';
import {
  contextSignalsFrom,
  FIELD_SPECS,
  quantityValue,
  type ExtractedFieldRecord,
  type ExtractionResult,
  type LLMAssistance,
} from '../extraction';
import type { AggregateOCRResult, OCRRegion } from '../ocr';

import type { FieldSuggestion, LabelReading } from './LLMProvider';

/**
 * ── THE MODEL'S READING BECOMES THE RECORD ──────────────────────────────────
 *
 * The deterministic extractor runs first, every time, because it is the
 * reading the scan falls back to and because it produces the things a model
 * is not asked for — which lines are pointers to another face of the pack,
 * what the commodity is, which lines nobody claimed. Then the model reads the
 * same text, and where it answered, *its* declarations replace the
 * extractor's, field for field.
 *
 * All of them, not just the gaps. A pattern that matched the wrong line
 * matches just as firmly as one that matched the right one: `MRP` paired with
 * the tail of a customer-care number came back as a price of `4655`, and a
 * PIN code was filed as a batch number. Keeping the extractor's value wherever
 * it had one would keep exactly those. The model is asked for every
 * declaration on the package and told never to invent one; a field it does
 * not report is recorded as not found, and the inspector settles it against
 * the package.
 *
 * ── STILL TIED TO THE PHOTOGRAPH ────────────────────────────────────────────
 *
 * A model's value has no box around it. So each one is looked for in the OCR
 * regions — the lines that share its letters and digits — and those regions
 * become its evidence, with the recogniser's confidence. The report can still
 * point at the place on the photograph a value came from, and a value the
 * text does not contain at all is visible as one with no evidence.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Letters and digits only, lower-cased: what survives a camera. */
function bare(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

/**
 * The OCR regions a value was read from.
 *
 * A region counts when its bare text sits inside the value's — the value is
 * assembled from lines, so each contributing line is a substring of it — or
 * when the value sits inside the region's, for a value cut from a longer line.
 * Short fragments are ignored: a two-character region matches everything.
 */
function regionsFor(value: string, correctedFrom: string | undefined, regions: OCRRegion[]): OCRRegion[] {
  const targets = [value, correctedFrom]
    .filter((text): text is string => typeof text === 'string')
    .map(bare)
    .filter((text) => text.length >= 3);

  return regions.filter((region) => {
    const text = bare(region.text);
    if (text.length < 3) return false;
    return targets.some((target) => target.includes(text) || text.includes(target));
  });
}

function evidenceOf(region: OCRRegion, ocr: AggregateOCRResult): EvidenceReference {
  const image = ocr.perImage.find((result) => result.imageId === region.imageId);
  const reference: EvidenceReference = { imageId: region.imageId, text: region.text };
  if (region.boundingBox) {
    reference.bbox = region.boundingBox;
    if (image?.imageSize) reference.space = image.imageSize;
  }
  if (typeof region.confidence === 'number') reference.confidence = region.confidence;
  return reference;
}

function recordFor(suggestion: FieldSuggestion, label: string, ocr: AggregateOCRResult): ExtractedFieldRecord {
  const regions = regionsFor(suggestion.value, suggestion.correctedFrom, ocr.regions);
  const evidence = regions.map((region) => evidenceOf(region, ocr));
  const confidences = regions
    .map((region) => region.confidence)
    .filter((value): value is number => typeof value === 'number');

  let value = suggestion.value;
  let unit: string | undefined;

  // The net quantity is the one declaration the engine wants split into a
  // number and a canonical unit, for the exemptions that turn on it.
  if (suggestion.field === 'net_quantity') {
    const parsed = quantityValue(suggestion.value);
    if (parsed?.unit) {
      value = parsed.value;
      unit = parsed.unit;
    }
  }

  return {
    field: suggestion.field,
    label,
    value,
    status: 'FOUND',
    ...(confidences.length > 0
      ? { confidence: confidences.reduce((sum, one) => sum + one, 0) / confidences.length }
      : {}),
    ...(unit ? { unit } : {}),
    evidence,
    method: 'MODEL',
    matchedText: suggestion.correctedFrom ?? regions[0]?.text,
    ...(suggestion.correctedFrom ? { repaired: true } : {}),
  };
}

export function adoptReading(
  extraction: ExtractionResult,
  reading: LabelReading,
  ocr: AggregateOCRResult,
): ExtractionResult {
  const assistance: LLMAssistance = {
    provider: reading.provider,
    model: reading.model,
    processingTimeMs: reading.processingTimeMs,
    adopted: false,
    suggestions: [],
  };

  if (reading.suggestions.length === 0) {
    /**
     * The model gave nothing. A label always carries *something* — a name, a
     * price — so an empty list is the stage failing, not the package being
     * blank, and the extractor's reading stands. Recorded either way: "the
     * model was asked and gave nothing" and "no model ran" are different facts
     * about a scan.
     */
    return {
      ...extraction,
      warnings: [
        ...extraction.warnings,
        `${reading.model} returned no reading; the declarations were read by the pattern extractor instead.`,
      ],
      llm: assistance,
    };
  }

  const fields: Record<string, ExtractedFieldRecord> = {};
  const informational: Record<string, ExtractedFieldRecord> = {};
  const bySuggestion = new Map(reading.suggestions.map((one) => [one.field, one]));

  for (const spec of FIELD_SPECS) {
    const target = spec.engineField ? fields : informational;
    const suggestion = bySuggestion.get(spec.field);

    if (suggestion) {
      target[spec.field] = recordFor(suggestion, spec.label, ocr);
      assistance.suggestions.push({
        field: spec.field,
        label: spec.label,
        value: suggestion.value,
        correctedFrom: suggestion.correctedFrom,
        applied: true,
      });
      continue;
    }

    target[spec.field] = {
      field: spec.field,
      label: spec.label,
      value: null,
      status: 'NOT_FOUND',
      evidence: [],
      method: 'MODEL',
    };
  }

  const claimed = new Set<string>();
  for (const record of [...Object.values(fields), ...Object.values(informational)]) {
    for (const reference of record.evidence) if (reference.text) claimed.add(reference.text);
  }

  return {
    ...extraction,
    engine: `${extraction.engine}+${reading.provider}`,
    engineVersion: `${extraction.engineVersion}+${reading.model}`,
    fields,
    informational,
    contextSignals: contextSignalsFrom(fields, informational),
    unclaimedLines: ocr.regions.map((region) => region.text).filter((text) => !claimed.has(text)),
    llm: { ...assistance, adopted: true },
  };
}
