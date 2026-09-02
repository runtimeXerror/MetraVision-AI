import type { EvidenceReference } from '../../compliance/types/Evidence';
import type { AggregateOCRResult, OCRRegion } from '../ocr';

import { firstAmount, normaliseLine, normaliseText, stripLabel } from './normalise';
import { ALL_LABELS, FIELD_SPECS, type ExtractionMethod, type FieldSpec } from './patterns';

/**
 * ── INFORMATION EXTRACTION ──────────────────────────────────────────────────
 *
 *      RAW OCR  →  NORMALISATION  →  FIELD EXTRACTION  →  STRUCTURED DATA
 *
 * The stage between reading a package and reasoning about it, and the one place
 * where a line of text becomes a named declaration.
 *
 * Three boundaries define it, and all three are load-bearing.
 *
 * It knows nothing about the law. It can tell you that a line beginning "MRP"
 * carries a price; it cannot tell you whether a price was required. Putting
 * that question here would give the system two rulebooks.
 *
 * It never asserts absence. A field this stage did not find is reported as
 * `NOT_FOUND`, which means "extraction did not locate this" and nothing more.
 * Whether that amounts to a missing declaration on the package is a question
 * about how well the package was photographed, and it is answered by the rule
 * engine against the capture evidence — see §16 of the brief and
 * `DecisionEngine.absenceStrength`.
 *
 * It never invents a confidence. Where the OCR provider supplied one, it is
 * carried through; where it did not, the field carries none, and the rule
 * engine treats a value of unknown reliability as a question for a person
 * rather than as a finding. A fabricated 0.9 here would become a violation
 * three layers down.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const EXTRACTION_ENGINE = 'rule-based-extractor';
export const EXTRACTION_ENGINE_VERSION = '1.0.0';

/**
 * How much confidence a digit repair costs.
 *
 * Applied when `repairDigits` changed a character to produce the value — a
 * repaired read is a read plus an inference, and it should not be acted on as
 * firmly as one the camera actually resolved. Lowering confidence can only move
 * a check toward review; it can never manufacture a violation.
 */
const REPAIR_CONFIDENCE_PENALTY = 0.8;

export interface ExtractedFieldRecord {
  field: string;
  label: string;
  /** `null` when extraction did not locate the declaration. */
  value: string | null;
  /** Present only when the OCR provider supplied one. Never synthesised. */
  confidence?: number;
  status: 'FOUND' | 'NOT_FOUND';
  unit?: string;
  evidence: EvidenceReference[];
  method: ExtractionMethod;
  /** The OCR line, verbatim, before any normalisation or repair. */
  matchedText?: string;
  /** True when a character substitution was needed to read the value. */
  repaired?: boolean;
}

/**
 * Facts about the package that the extraction saw and that change which rules
 * apply. Surfaced separately, and never folded silently into the request: an
 * inference that switches a rule on has to be visible to the inspector who will
 * defend the finding.
 */
export interface ContextSignal {
  key: string;
  value: string | number | boolean;
  basis: string;
  evidence: EvidenceReference[];
}

export interface ExtractionResult {
  engine: string;
  engineVersion: string;
  /** Keyed by the rule set's own field names. Fed to the engine. */
  fields: Record<string, ExtractedFieldRecord>;
  /** Recorded and displayed; never part of a legal check. */
  informational: Record<string, ExtractedFieldRecord>;
  contextSignals: ContextSignal[];
  /** Lines no field claimed, so nothing the camera read is silently discarded. */
  unclaimedLines: string[];
  /** Notes for the report about how a value was arrived at. */
  warnings: string[];
  processingTimeMs: number;
  /** Total lines the OCR stage produced across every image. */
  lineCount: number;
}

/* ── Working line record ──────────────────────────────────────────────────── */

interface Line {
  index: number;
  /** Normalised for matching. */
  text: string;
  /** Exactly what the OCR provider returned. */
  raw: string;
  region?: OCRRegion;
  /** Set once an engine field has taken this line. */
  claimedBy?: string;
}

function evidenceFor(line: Line, space: { width: number; height: number } | undefined): EvidenceReference {
  const reference: EvidenceReference = {
    imageId: line.region?.imageId ?? 'unknown',
    text: line.raw,
  };

  if (line.region?.boundingBox) {
    reference.bbox = line.region.boundingBox;
    if (space) reference.space = space;
  }
  if (typeof line.region?.confidence === 'number') {
    reference.confidence = line.region.confidence;
  }

  return reference;
}

/** The mean of whatever confidences the provider actually gave for these lines. */
function confidenceOf(lines: Line[]): number | undefined {
  const values = lines
    .map((line) => line.region?.confidence)
    .filter((value): value is number => typeof value === 'number');

  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** True when a line opens a different declaration, ending a continuation. */
function startsNewDeclaration(text: string): boolean {
  return ALL_LABELS.some((label) => label.test(text));
}

/** An address is complete once a PIN code has been seen. */
const HAS_PIN = /\b\d{6}\b/;

/* ── The service ──────────────────────────────────────────────────────────── */

export class InformationExtractionService {
  readonly engine = EXTRACTION_ENGINE;
  readonly engineVersion = EXTRACTION_ENGINE_VERSION;

  extract(ocr: AggregateOCRResult): ExtractionResult {
    const startedAt = Date.now();

    const lines = this.linesFrom(ocr);
    const spaceByImage = new Map<string, { width: number; height: number } | undefined>();
    for (const image of ocr.perImage) {
      spaceByImage.set(image.imageId, image.imageSize);
    }

    const fields: Record<string, ExtractedFieldRecord> = {};
    const informational: Record<string, ExtractedFieldRecord> = {};
    const warnings: string[] = [];

    for (const spec of FIELD_SPECS) {
      const found = this.findField(spec, lines, spaceByImage);
      const bucket = spec.engineField ? fields : informational;

      bucket[spec.field] = found ?? {
        field: spec.field,
        label: spec.label,
        value: null,
        status: 'NOT_FOUND',
        evidence: [],
        method: 'PATTERN_MATCH',
      };
    }

    // Heuristics run last, over whatever is left, so they cannot take a line a
    // pattern would have claimed with certainty.
    this.applyNameHeuristics(lines, spaceByImage, fields, informational, warnings);

    const contextSignals = this.contextSignalsFrom(fields, informational);

    return {
      engine: this.engine,
      engineVersion: this.engineVersion,
      fields,
      informational,
      contextSignals,
      unclaimedLines: lines.filter((line) => !line.claimedBy).map((line) => line.raw),
      warnings,
      processingTimeMs: Date.now() - startedAt,
      lineCount: lines.length,
    };
  }

  /**
   * Located regions are preferred over the raw text blob, because only they
   * carry a bounding box — and a finding an inspector cannot see on the
   * photograph is a finding they cannot check. The raw text is the fallback for
   * a provider that returns no geometry at all.
   */
  private linesFrom(ocr: AggregateOCRResult): Line[] {
    if (ocr.regions.length > 0) {
      return ocr.regions.map((region, index) => ({
        index,
        text: normaliseLine(region.text),
        raw: region.text,
        region,
      }));
    }

    return normaliseText(ocr.rawText).map((text, index) => ({ index, text, raw: text }));
  }

  private findField(
    spec: FieldSpec,
    lines: Line[],
    spaceByImage: Map<string, { width: number; height: number } | undefined>,
  ): ExtractedFieldRecord | null {
    // Labelled forms first: a printed label is direct evidence of what the
    // declaration is, and a pattern match is only an inference about it.
    for (const pass of ['LABEL_MATCH', 'PATTERN_MATCH'] as const) {
      for (const line of lines) {
        // Informational fields may re-read a line an engine field already took —
        // "Imported by ..." is both the rule 6(1)(a) declaration and the
        // importer. Engine fields never share.
        if (line.claimedBy && spec.engineField) continue;
        if (spec.exclude?.test(line.text)) continue;

        let after: string | null = null;

        if (pass === 'LABEL_MATCH') {
          const label = spec.labels.find((candidate) => candidate.test(line.text));
          if (!label) continue;
          after = stripLabel(line.text, label);
        } else {
          if (!spec.unlabelled?.test(line.text)) continue;
          after = line.text;
        }

        const value = spec.extract(after, line.text);
        if (!value) continue;

        const used = [line];

        if (spec.continuation) {
          used.push(...this.continuationOf(line, lines, spec));
        }

        const text = used.length > 1 ? used.map((entry) => entry.text).join(', ') : value.value;
        const base = confidenceOf(used);

        if (spec.engineField) {
          for (const entry of used) entry.claimedBy = spec.field;
        }

        return {
          field: spec.field,
          label: spec.label,
          // A continuation rewrites the value to the joined text, because half
          // an address is a worse answer than the whole one.
          value: used.length > 1 && value.value === line.text.trim() ? text : value.value,
          confidence:
            base === undefined ? undefined : value.repaired ? base * REPAIR_CONFIDENCE_PENALTY : base,
          status: 'FOUND',
          unit: value.unit,
          evidence: used.map((entry) => evidenceFor(entry, spaceByImage.get(entry.region?.imageId ?? ''))),
          method: pass,
          matchedText: used.map((entry) => entry.raw).join(' '),
          repaired: value.repaired,
        };
      }
    }

    return null;
  }

  /**
   * Following lines that belong to the same declaration.
   *
   * Bounded three ways — a new label, a completed address, and a hard limit of
   * three lines — because an unbounded continuation swallows the rest of the
   * label and turns every field into the whole package.
   */
  private continuationOf(start: Line, lines: Line[], spec: FieldSpec): Line[] {
    const taken: Line[] = [];
    if (HAS_PIN.test(start.text)) return taken;

    for (let index = start.index + 1; index < lines.length && taken.length < 3; index += 1) {
      const line = lines[index];
      if (!line) break;
      if (line.claimedBy) break;
      if (startsNewDeclaration(line.text)) break;
      // A continuation must look like more of an address, not a new heading.
      if (line.text.length < 3) break;

      taken.push(line);
      if (HAS_PIN.test(line.text)) break;
    }

    // Only claim the continuation when the spec owns the lines it consumed.
    return spec.engineField || spec.continuation ? taken : [];
  }

  /**
   * Brand and commodity name.
   *
   * Neither is printed with a label, so neither can be extracted the way the
   * rest of the table is. The heuristic — brand is the first line, the generic
   * name is the wordiest unclaimed line just below it — is a reading of how
   * labels are laid out and not a reading of the law, and it is recorded as
   * `HEURISTIC` and warned about so that an inspector treats it as a starting
   * point rather than as a determination.
   */
  private applyNameHeuristics(
    lines: Line[],
    spaceByImage: Map<string, { width: number; height: number } | undefined>,
    fields: Record<string, ExtractedFieldRecord>,
    informational: Record<string, ExtractedFieldRecord>,
    warnings: string[],
  ): void {
    const head = lines.slice(0, 5);
    const brandLine = head.find((line) => !line.claimedBy && line.text.length >= 2);

    if (brandLine) {
      informational.brand = {
        field: 'brand',
        label: 'Brand',
        value: brandLine.text,
        confidence: confidenceOf([brandLine]),
        status: 'FOUND',
        evidence: [evidenceFor(brandLine, spaceByImage.get(brandLine.region?.imageId ?? ''))],
        method: 'HEURISTIC',
        matchedText: brandLine.raw,
      };
    }

    const existing = fields.commodity_name;
    if (!existing || existing.status === 'NOT_FOUND') {
      const candidates = head.filter(
        (line) =>
          !line.claimedBy &&
          line !== brandLine &&
          line.text.length >= 3 &&
          // Contains a letter, Latin or Devanagari. The Devanagari range
          // starts at U+0904 rather than U+0900 because U+0900-U+0903 are
          // combining signs, not letters — and a combining mark inside a
          // character class is read one way by a regex engine and another by
          // anyone maintaining it.
          /[A-Za-z\u0904-\u0939]/.test(line.text),
      );

      // Most words wins; a later line wins a tie, because the generic name sits
      // below the brand line and any sub-brand.
      const best = candidates.reduce<Line | undefined>((chosen, line) => {
        if (!chosen) return line;
        const words = (text: string): number => text.split(/\s+/).length;
        return words(line.text) >= words(chosen.text) ? line : chosen;
      }, undefined);

      if (best) {
        best.claimedBy = 'commodity_name';
        fields.commodity_name = {
          field: 'commodity_name',
          label: 'Common or generic name',
          value: best.text,
          confidence: confidenceOf([best]),
          status: 'FOUND',
          evidence: [evidenceFor(best, spaceByImage.get(best.region?.imageId ?? ''))],
          method: 'HEURISTIC',
          matchedText: best.raw,
        };
        warnings.push(
          `The common or generic name was identified by layout rather than by a printed label ("${best.text}"). Confirm it against the package.`,
        );
      }
    }

    const brand = informational.brand?.value;
    const commodity = fields.commodity_name?.value;
    const productName = [brand, commodity].filter(Boolean).join(' ').trim();

    if (productName !== '') {
      informational.product_name = {
        field: 'product_name',
        label: 'Product name',
        value: productName,
        status: 'FOUND',
        evidence: [
          ...(informational.brand?.evidence ?? []),
          ...(fields.commodity_name?.evidence ?? []),
        ],
        method: 'DERIVED',
      };
    }
  }

  /**
   * Facts that change which rules reach the package.
   *
   * Reported, not applied. `ComplianceInputAdapter` decides whether to adopt a
   * signal, and only where the caller left the corresponding context unset — an
   * inspector who has told the system the package is domestic is not overruled
   * by a line of OCR text.
   */
  private contextSignalsFrom(
    fields: Record<string, ExtractedFieldRecord>,
    informational: Record<string, ExtractedFieldRecord>,
  ): ContextSignal[] {
    const signals: ContextSignal[] = [];

    const importer = informational.importer;
    if (importer?.status === 'FOUND') {
      signals.push({
        key: 'isImported',
        value: true,
        basis: 'An importer declaration was read on the package.',
        evidence: importer.evidence,
      });
    }

    const origin = fields.country_of_origin;
    if (origin?.status === 'FOUND' && origin.value) {
      signals.push({
        key: 'countryOfOrigin',
        value: origin.value,
        basis: 'Read from the country-of-origin declaration.',
        evidence: origin.evidence,
      });
      if (!/\bindia\b/i.test(origin.value)) {
        signals.push({
          key: 'isImported',
          value: true,
          basis: `The declared country of origin is "${origin.value}".`,
          evidence: origin.evidence,
        });
      }
    }

    const quantity = fields.net_quantity;
    if (quantity?.status === 'FOUND' && quantity.value) {
      const amount = firstAmount(quantity.value);
      if (amount !== null) {
        signals.push({
          key: 'quantity',
          value: amount,
          basis: 'Parsed from the net-quantity declaration.',
          evidence: quantity.evidence,
        });
      }
      if (quantity.unit) {
        signals.push({
          key: 'quantityUnit',
          value: quantity.unit,
          basis: 'Parsed from the net-quantity declaration.',
          evidence: quantity.evidence,
        });
      }
    }

    if (informational.fssai_licence?.status === 'FOUND') {
      signals.push({
        key: 'isFoodArticle',
        value: true,
        basis: 'An FSSAI licence number was read on the package.',
        evidence: informational.fssai_licence.evidence,
      });
    }

    return signals;
  }
}

export const extractionService = new InformationExtractionService();

/** The function callers use. Keeps the class an implementation detail. */
export function extractInformation(ocr: AggregateOCRResult): ExtractionResult {
  return extractionService.extract(ocr);
}
