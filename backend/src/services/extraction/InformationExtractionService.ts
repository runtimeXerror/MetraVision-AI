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
  /**
   * Set only once an inspector has ruled on this declaration with the package
   * in front of them. Absent means nobody has looked yet — which is not the
   * same as "nothing is wrong", and the engine treats it accordingly.
   *
   * Written by `verifiedReevaluation`; the extraction stage never sets it.
   */
  verification?: 'ACCEPTED' | 'EDITED' | 'MARKED_UNAVAILABLE';
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

    /**
     * Legibility, for the readability checks in `evidenceValidator`.
     *
     * The recogniser's confidence is a *proxy* and it is worth being precise
     * about what it is not: it measures how sure the model is of the
     * characters, which conflates a badly printed declaration with a badly
     * photographed one, and with a font the model simply finds unusual. It is
     * evidence that a declaration may be hard to read. It is not a measurement
     * of print quality.
     *
     * Supplying it anyway is right, because the alternative is that every
     * readability check stays INSUFFICIENT_EVIDENCE for ever and the system
     * silently does not perform a check the rules require. What keeps it
     * honest is that the same number is the field's confidence, so a weak
     * reading fails `thresholds.sufficient` in `DecisionEngine` and the check
     * becomes REVIEW_REQUIRED — a question for the inspector standing in front
     * of the package, never a violation on its own. That is exactly the rule
     * the brief sets: low OCR confidence must not become legal non-compliance.
     */
    reference.measurements = { legibility: line.region.confidence };
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

/* ── Geometry: finding a value that sits beside its label ─────────────────── */

/**
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A declaration is not always one line of text.
 *
 * On a real Haldiram's packet the label and its value are two separate
 * detections — `NET QUANTITY:` at x 1436–1798, and `200g` at x 1864–2001 on
 * the same row. The label pass matched `NET QUANTITY:`, found nothing after
 * the colon, gave up, and the pattern pass then claimed `22.2 g` from the
 * *nutrition table* as the net quantity. The package declares 200g; the report
 * said 22.2g, and the rule engine recorded a violation on it.
 *
 * That is the worst failure mode this system has: not a missed declaration,
 * but a confidently wrong one, sourced from somewhere else on the packet.
 *
 * Printed labels put the value to the right of the label, or directly beneath
 * it. Both are found here by geometry rather than by reading order, because
 * reading order is exactly what a multi-column packet destroys — no
 * linearisation of a two-column declaration block is correct, so the fix
 * cannot be a better sort.
 *
 * This is only possible because the OCR provider returns a box per line.
 */

type Box = [number, number, number, number];

function boxOf(line: Line): Box | undefined {
  return line.region?.boundingBox;
}

/** Fraction of the shorter span where two intervals overlap. 0 when disjoint. */
function overlapRatio(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  if (overlap <= 0) return 0;

  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  return shorter > 0 ? overlap / shorter : 0;
}

/** Same printed row: vertical spans overlap for most of the shorter one. */
const SAME_ROW = 0.5;
/** Same column: horizontal spans overlap enough to be under the same heading. */
const SAME_COLUMN = 0.35;
/**
 * How far a value may sit from its label, as a multiple of the label's own
 * height. Generous enough for the whitespace a designer leaves between a
 * declaration and its value, tight enough that it cannot reach the next
 * column of an unrelated table.
 */
const MAX_GAP_RIGHT = 3;
const MAX_GAP_BELOW = 1.5;

/**
 * Candidate value lines for a label, nearest first.
 *
 * Right-hand neighbours are preferred over ones below: `NET QUANTITY: 200g`
 * reads across, and a line below a label is as likely to be the next
 * declaration as it is to be this one's value.
 */
function neighboursOf(label: Line, lines: Line[]): Line[] {
  const anchor = boxOf(label);
  if (!anchor) return [];

  const [ax1, ay1, ax2, ay2] = anchor;
  const height = ay2 - ay1;
  if (height <= 0) return [];

  const right: Array<{ line: Line; gap: number }> = [];
  const below: Array<{ line: Line; gap: number }> = [];

  for (const candidate of lines) {
    if (candidate === label) continue;
    // Never pull a value out of another image — a box from photograph two says
    // nothing about where this declaration sits on photograph one.
    if (candidate.region?.imageId !== label.region?.imageId) continue;

    const box = boxOf(candidate);
    if (!box) continue;

    const [bx1, by1, bx2, by2] = box;

    if (overlapRatio(ay1, ay2, by1, by2) >= SAME_ROW && bx1 >= ax1) {
      const gap = bx1 - ax2;
      if (gap >= -height && gap <= MAX_GAP_RIGHT * height) right.push({ line: candidate, gap });
      continue;
    }

    if (overlapRatio(ax1, ax2, bx1, bx2) >= SAME_COLUMN && by1 >= ay2) {
      const gap = by1 - ay2;
      if (gap <= MAX_GAP_BELOW * height) below.push({ line: candidate, gap });
    }
  }

  const nearestFirst = (a: { gap: number }, b: { gap: number }): number => a.gap - b.gap;

  return [
    ...right.sort(nearestFirst).map((entry) => entry.line),
    ...below.sort(nearestFirst).map((entry) => entry.line),
  ];
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

        let value = spec.extract(after, line.text);
        /**
         * The value sits beside the label rather than on it.
         *
         * Only attempted on the label pass, and only once the label itself has
         * yielded nothing: a printed label is direct evidence of *which*
         * declaration this is, so a value found next to one is far better
         * sourced than the same string matched by shape somewhere else on the
         * packet. Without this the pattern pass claims whichever number it
         * meets first — on a food label, that is the nutrition table.
         */
        let valueLine: Line | undefined;

        if (!value && pass === 'LABEL_MATCH') {
          for (const neighbour of neighboursOf(line, lines)) {
            if (neighbour.claimedBy && spec.engineField) continue;
            if (spec.exclude?.test(neighbour.text)) continue;

            const candidate = spec.extract(neighbour.text, neighbour.text);
            if (candidate) {
              value = candidate;
              valueLine = neighbour;
              break;
            }
          }
        }

        if (!value) continue;

        // The label line is kept in the evidence even when the value came from
        // beside it: an inspector checking the finding needs to see the words
        // that made this a net quantity and not some other number.
        const used = valueLine ? [line, valueLine] : [line];

        if (spec.continuation) {
          // Continues from wherever the value was actually read. Starting at
          // the label would walk the lines after "Manufactured by:" while the
          // address itself began one line to the right.
          used.push(...this.continuationOf(valueLine ?? line, lines, spec));
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
