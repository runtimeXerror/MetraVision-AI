import type { EvidenceReference } from '../../compliance/types/Evidence';
import type { AggregateOCRResult, OCRRegion } from '../ocr';

import { firstAmount, normaliseLine, normaliseText, stripLabel } from './normalise';
import type { ProductCategory } from '../../types/domain';

import { categoryFrom, commodityNounIn, type CommodityMatch } from './commodity';
import {
  ALL_LABELS,
  FIELD_SPECS,
  declaredElsewhereIn,
  isPointerLine,
  type ExtractionMethod,
  type FieldSpec,
} from './patterns';

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
  /**
   * Declarations the package itself says are printed elsewhere on it — on the
   * carton, on the crimp. Not found here, and not absent either; the engine is
   * told the difference so it sends these to an inspector rather than
   * recording them as missing.
   */
  declaredElsewhere: string[];
  /**
   * What the package holds, classified from the commodity nouns printed on it.
   *
   * Reported, never applied here. The category decides which rules reach the
   * package at all, so an inspector's own statement outranks a vocabulary
   * match — `ComplianceInputAdapter` adopts this only where the caller left
   * the category unset. Absent when the nouns on the label disagree, or carry
   * no category between them.
   */
  category?: { value: ProductCategory; confidence: number };
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

/**
 * How large this line is printed, as a multiple of the median on its own
 * photograph.
 *
 * The measurement is the box's *short* side, which is the text's height
 * whichever way the package was photographed. Normalised per image because the
 * number has to mean "prominent on the pack" and not "photographed closer" —
 * two photographs of the same tube from different distances must rank their
 * own lines the same way.
 *
 * This is the signal that names a product. A brand is the biggest thing
 * printed on the front of a package; that is what a brand *is*, and it is
 * visible in the geometry the recogniser already returns. The heuristic it
 * replaces — the first line the OCR happened to emit — carried no information
 * about the label at all.
 */
function prominenceIndex(lines: Line[]): Map<Line, number> {
  const heightOf = (line: Line): number | undefined => {
    const box = boxOf(line);
    if (!box) return undefined;

    const [x1, y1, x2, y2] = box;
    return Math.min(x2 - x1, y2 - y1);
  };

  const byImage = new Map<string, number[]>();
  for (const line of lines) {
    const height = heightOf(line);
    if (height === undefined || height <= 0) continue;

    const key = line.region?.imageId ?? '';
    byImage.set(key, [...(byImage.get(key) ?? []), height]);
  }

  const medians = new Map<string, number>();
  for (const [key, heights] of byImage) {
    const sorted = [...heights].sort((a, b) => a - b);
    medians.set(key, sorted[Math.floor(sorted.length / 2)] ?? 1);
  }

  const index = new Map<Line, number>();
  for (const line of lines) {
    const height = heightOf(line);
    const median = medians.get(line.region?.imageId ?? '');
    if (height !== undefined && median) index.set(line, height / median);
  }

  return index;
}

/** True when a line opens a different declaration, ending a continuation. */
function startsNewDeclaration(text: string): boolean {
  return ALL_LABELS.some((label) => label.test(text));
}

/**
 * Below this, a reading is not sure enough to name a product from.
 *
 * The same floor the OCR sidecar uses to decide a page is worth re-reading.
 * Every other field here is anchored by a printed label; a name is anchored by
 * nothing, so the reading itself has to carry it.
 */
/**
 * How much larger than its panel's body text a line must be to be a brand.
 *
 * A ratio against the median line height of the *same photograph*, so it means
 * "set large on the pack" rather than "photographed closer". 1.25 sits below
 * every real brand mark seen so far and above the taglines and variant names
 * that compete with them, and — the point of it — above everything on a panel
 * that carries no brand at all, which then correctly yields none.
 */
const BRAND_MIN_PROMINENCE = 1.25;

const NAME_MIN_CONFIDENCE = 0.8;

/**
 * Text that cannot be a product name, whatever it is doing at the top of the
 * page: contact details, an address, a registration or batch code, and the
 * boilerplate around them.
 */
const NOT_A_NAME =
  /(?:@|https?:|www\.|\b\d{5,}\b|\+?\d[\d\s-]{8,}|\b(?:pvt|ltd|limited|inc|gmbh|co)\b\.?|\bfloor\b|\bindustrial\b|\bestate\b|\bmarket\b|\broad\b|\bstreet\b|\bcontact\b|\bfeedback\b|\bquer(?:y|ies)\b|\bcomplaints?\b|\baddress\b|\bexecutive\b|\bmanager\b|\breg\.?\s*tm\b|\bregd?\b)/i;

/** Whether a line could be the name of the thing in the package. */
function couldBeAName(line: Line): boolean {
  if (NOT_A_NAME.test(line.text)) return false;

  const confidence = line.region?.confidence;
  if (typeof confidence === 'number' && confidence < NAME_MIN_CONFIDENCE) return false;

  // Mostly letters. A line that is half punctuation is a misread, not a name.
  const letters = (line.text.match(/[A-Za-zऄ-ह]/g) ?? []).length;
  return letters >= 3 && letters / line.text.length >= 0.6;
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
 *
 * ── AND BECAUSE THE BOXES ARE READ IN THE TEXT'S FRAME, NOT THE CAMERA'S ───
 *
 * "To the right of" is a fact about the printed label, and the box is in
 * *image* coordinates. Those two agree only while the photograph is upright.
 *
 * They very often are not. A cylindrical package — a deodorant bottle, a
 * shampoo tube — is photographed sideways because that is how it fits in the
 * frame, and its declaration block then runs top-to-bottom down the image. The
 * recogniser copes: it classifies each line's own orientation and returns the
 * text the right way round. The boxes stay where they were. So every
 * comparison below was made ninety degrees out — `Batch No.:` "found its
 * value to the right" and got `Moo 17, Soi Industr`, a fragment of the
 * factory address on the next printed line.
 *
 * So each line is measured along its *own* reading direction, and only lines
 * running the same way are compared. On an upright photograph this is the
 * identity and nothing changes.
 */

type Box = [number, number, number, number];

function boxOf(line: Line): Box | undefined {
  return line.region?.boundingBox;
}

/**
 * Which way this line of text runs.
 *
 * From the box alone: a line is long along the direction it reads. Too short a
 * line carries no such evidence — `50ml` is nearly square — so anything under
 * four characters is left at the page's usual direction rather than guessed at.
 */
function orientationOf(line: Line): 'horizontal' | 'vertical' {
  const box = boxOf(line);
  if (!box || line.text.trim().length < 4) return 'horizontal';

  const [x1, y1, x2, y2] = box;
  return y2 - y1 > x2 - x1 ? 'vertical' : 'horizontal';
}

/**
 * The box in the text's own frame: `along` the reading direction, `across` the
 * stacking of successive printed lines.
 *
 * For sideways text the reading direction is the image's +y, and successive
 * printed lines march towards *smaller* x — so the cross axis is negated to
 * keep "the next line down" pointing the same way it does for upright text.
 * Everything below can then be written once.
 */
function readingBox(box: Box, orientation: 'horizontal' | 'vertical'): Box {
  const [x1, y1, x2, y2] = box;
  return orientation === 'vertical' ? [y1, -x2, y2, -x1] : [x1, y1, x2, y2];
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

  const orientation = orientationOf(label);
  const [ax1, ay1, ax2, ay2] = readingBox(anchor, orientation);
  const height = ay2 - ay1;
  if (height <= 0) return [];

  const right: Array<{ line: Line; gap: number }> = [];
  const below: Array<{ line: Line; gap: number }> = [];

  for (const candidate of lines) {
    if (candidate === label) continue;
    // Never pull a value out of another image — a box from photograph two says
    // nothing about where this declaration sits on photograph one.
    if (candidate.region?.imageId !== label.region?.imageId) continue;
    // Nor out of text running the other way. On a package photographed
    // sideways the panel that wrapped around the curve is read at ninety
    // degrees to the panel facing the camera, and the two share no geometry.
    if (orientationOf(candidate) !== orientation) continue;

    const box = boxOf(candidate);
    if (!box) continue;

    const [bx1, by1, bx2, by2] = readingBox(box, orientation);

    if (overlapRatio(ay1, ay2, by1, by2) >= SAME_ROW && bx1 >= ax1) {
      const gap = bx1 - ax2;
      if (gap >= -height && gap <= MAX_GAP_RIGHT * height) right.push({ line: candidate, gap });
      continue;
    }

    if (overlapRatio(ax1, ax2, bx1, bx2) >= SAME_COLUMN && by1 >= ay2 - height / 2) {
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

/**
 * The next printed line under this one, or nothing.
 *
 * Used to walk an address, which is the one declaration that genuinely runs
 * over several lines. It follows the printed layout rather than the OCR's
 * reading order for the same reason `neighboursOf` does: on a package
 * photographed sideways the recogniser emitted this block bottom-up, so
 * "the next line" by index was the line *above* — and `Imported & Marketed
 * by:` continued into `49,4.98/ml`, the unit price from the column beside it.
 */
function lineBelow(line: Line, lines: Line[]): Line | undefined {
  const anchor = boxOf(line);
  if (!anchor) return undefined;

  const orientation = orientationOf(line);
  const [ax1, ay1, ax2, ay2] = readingBox(anchor, orientation);
  const height = ay2 - ay1;
  if (height <= 0) return undefined;

  let best: { line: Line; gap: number } | undefined;

  for (const candidate of lines) {
    if (candidate === line) continue;
    if (candidate.region?.imageId !== line.region?.imageId) continue;
    if (orientationOf(candidate) !== orientation) continue;

    const box = boxOf(candidate);
    if (!box) continue;

    const [bx1, by1, bx2] = readingBox(box, orientation);
    if (overlapRatio(ax1, ax2, bx1, bx2) < SAME_COLUMN) continue;

    const gap = by1 - ay2;
    if (gap < -height / 2 || gap > MAX_GAP_BELOW * height) continue;
    if (!best || gap < best.gap) best = { line: candidate, gap };
  }

  return best?.line;
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

    /**
     * `For MRP, refer to the carton` — read before anything else, because a
     * pointer must be claimed before the matchers reach it. Left unclaimed,
     * `batch no.` inside that sentence matched the batch-number label and the
     * words after it were recorded as the batch number.
     */
    const declaredElsewhere = new Set<string>();

    for (const [index, line] of lines.entries()) {
      if (!isPointerLine(line.text)) continue;
      line.claimedBy = 'declared_elsewhere';

      /**
       * The sentence usually wraps, and the half naming the declarations is
       * the half that gets left behind:
       *
       *     For the manufacturing date, batch no. & Use before date-
       *     refer to the crimp
       *
       * Only the second line carries the pointer, and only the first names
       * what it points at, so neither line means anything alone. The line
       * before is folded in, and claimed only when it actually contributed —
       * an unrelated neighbour must not be swallowed.
       */
      const previous = lines[index - 1];
      const ownTargets = declaredElsewhereIn(line.text);
      const joinedTargets = previous
        ? declaredElsewhereIn(`${previous.text} ${line.text}`)
        : ownTargets;

      for (const field of joinedTargets) declaredElsewhere.add(field);

      if (previous && !previous.claimedBy && joinedTargets.length > ownTargets.length) {
        previous.claimedBy = 'declared_elsewhere';
      }
    }

    if (declaredElsewhere.size > 0) {
      warnings.push(
        `The package states that ${[...declaredElsewhere]
          .map((field) => FIELD_SPECS.find((spec) => spec.field === field)?.label ?? field)
          .join(', ')} ${declaredElsewhere.size === 1 ? 'is' : 'are'} printed elsewhere on it — ` +
          'on the carton or the crimp. Check there before treating any of them as missing.',
      );
    }

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
    const category = this.applyNameHeuristics(
      lines,
      spaceByImage,
      fields,
      informational,
      warnings,
    );

    const contextSignals = this.contextSignalsFrom(fields, informational);

    return {
      engine: this.engine,
      engineVersion: this.engineVersion,
      fields,
      informational,
      contextSignals,
      unclaimedLines: lines.filter((line) => !line.claimedBy).map((line) => line.raw),
      warnings,
      declaredElsewhere: [...declaredElsewhere],
      ...(category ? { category } : {}),
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
        /**
         * A sentence saying where a declaration is printed is not that
         * declaration, for *any* field.
         *
         * The `claimedBy` test above lets informational fields re-read a
         * claimed line on purpose — `Imported by …` is both the rule 6(1)(a)
         * declaration and the importer — so a pointer has to be excluded in
         * its own right, or the batch number comes back as the words
         * `& Use before date-` from the sentence that says where the real one
         * is stamped.
         */
        if (line.claimedBy === 'declared_elsewhere' || isPointerLine(line.text)) continue;
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

            /**
             * A line that is itself a declaration's label is nobody's value.
             *
             * A two-column block stacks its keys — `Batch No.:`, `MFD.(P) &`,
             * `Use Before (E):` — one under the next, so the nearest thing
             * below any key is the following key. Taking it produced a batch
             * number of "MFD.(P) &".
             */
            if (startsNewDeclaration(neighbour.text)) continue;

            // And what is taken has to look like the declaration being read.
            // Beside a label, position is the only evidence there is, and
            // position alone is satisfied by the address underneath.
            if (spec.neighbour && !spec.neighbour.test(neighbour.text)) continue;

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

        /**
         * The value is everything that was read for it, joined.
         *
         * `used` opens with the label line, and that line belongs in the value
         * only when the value was read *from* it — `Manufactured By, L.B.C.,
         * Unit II, Haridwar…` is the declaration as printed, and the wording
         * is part of what several rules inspect. Where the value came from a
         * neighbouring line instead, the label is evidence and not value.
         *
         * The old form asked whether `value.value` equalled the label line,
         * which is only ever true in the first case — so an ingredient list
         * found *beside* its heading kept its first line and silently dropped
         * the five that continued it. They were in the evidence the whole
         * time; nothing put them in the answer.
         */
        const valueLines = valueLine ? used.slice(1) : used;
        const text =
          valueLines.length > 1 ? valueLines.map((entry) => entry.text).join(', ') : value.value;
        const base = confidenceOf(used);

        if (spec.engineField) {
          for (const entry of used) entry.claimedBy = spec.field;
        }

        return {
          field: spec.field,
          label: spec.label,
          // A continuation rewrites the value to the joined text, because half
          // an address is a worse answer than the whole one.
          value: valueLines.length > 1 ? text : value.value,
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

    // Three lines is an address. An ingredient list is seven, and truncating
    // one is not a shorter answer — it is a different one, missing whichever
    // ingredient the rule happens to be about.
    const limit = typeof spec.continuation === 'number' ? spec.continuation : 3;

    // Geometry where there is any, and the OCR's reading order only as the
    // fallback for a provider that returns no boxes at all.
    const located = boxOf(start) !== undefined;
    let current = start;

    while (taken.length < limit) {
      const line = located
        ? lineBelow(current, lines)
        : lines[current.index + 1];

      if (!line) break;
      if (line.claimedBy) break;
      if (startsNewDeclaration(line.text)) break;
      // A continuation must look like more of an address, not a new heading.
      if (line.text.length < 3) break;

      taken.push(line);
      current = line;
      if (HAS_PIN.test(line.text)) break;
    }

    // Only claim the continuation when the spec owns the lines it consumed.
    return spec.engineField || spec.continuation ? taken : [];
  }

  /**
   * Brand and commodity name.
   *
   * Neither is printed with a label — a package says `MOISTURIZER`, never
   * `Common name: moisturizer` — so neither can be found the way the rest of
   * the table is. Two different signals do it instead, and both are readings
   * of how labels are laid out rather than readings of the law, which is why
   * every value here is recorded as `HEURISTIC` and warned about.
   *
   * ── THE COMMODITY NAME IS A NOUN ────────────────────────────────────────
   *
   * Rule 6(1)(b) wants what the thing *is*. That is a word from a vocabulary —
   * see `commodity.ts` — and looking it up finds `MOISTURIZER` where the
   * previous rule, "the wordiest of the first five lines", found
   * `+ hyaluronic acid + betaine`. The same noun classifies the package, so
   * the category comes from the same evidence and points at the same word.
   *
   * ── THE BRAND IS THE BIGGEST THING ON THE PACKAGE ───────────────────────
   *
   * Which is what a brand is, and it is in the geometry already: `Minimalist`
   * is printed at 1.8x the median line height of the panel it is on, and
   * `Vitamin B5` — the variant, which the old heuristic returned — at 1.25x.
   * Where a commodity noun was found, the brand is preferred from the *same*
   * photograph, because the two are printed together on the front and the back
   * of a package carries neither.
   *
   * ── AND NEITHER IS INVENTED ─────────────────────────────────────────────
   *
   * A line has to be one the recogniser actually read and capable of being a
   * name at all. Without those guards a photograph of the back of a package —
   * which carries no product name anywhere on it — still produced one: on the
   * scan that prompted this, `anacur: Beirhi Co.`, read at 0.54 out of the
   * blur where the label curved away. Finding no name on a panel that does not
   * carry one is the correct answer.
   */
  private applyNameHeuristics(
    lines: Line[],
    spaceByImage: Map<string, { width: number; height: number } | undefined>,
    fields: Record<string, ExtractedFieldRecord>,
    informational: Record<string, ExtractedFieldRecord>,
    warnings: string[],
  ): { value: ProductCategory; confidence: number } | undefined {
    const prominence = prominenceIndex(lines);
    const sizeOf = (line: Line): number => prominence.get(line) ?? 0;

    const record = (
      field: string,
      label: string,
      line: Line,
      value: string,
    ): ExtractedFieldRecord => ({
      field,
      label,
      value,
      confidence: confidenceOf([line]),
      status: 'FOUND',
      evidence: [evidenceFor(line, spaceByImage.get(line.region?.imageId ?? ''))],
      method: 'HEURISTIC',
      matchedText: line.raw,
    });

    /* ── The brand, by prominence ────────────────────────────────────────── */

    /**
     * The largest name-capable text anywhere on the package.
     *
     * Found first, and it is what settles which photograph is the front. A
     * back panel has its own largest line — `HideNothing.`, a tagline above
     * the ingredient list — and ranking each panel's lines against that
     * panel's own median makes the two comparable: `Minimalist` at 1.83x the
     * front's median beats it, and does so without this code being told which
     * photograph the inspector meant as the front.
     */
    const brandLine = lines
      .filter((line) => !line.claimedBy && couldBeAName(line))
      // Prominent, not merely the largest of a bad lot. Without the threshold
      // this returns the biggest line of *whatever it was given* — so a reading
      // that is all noise and taglines still yields a brand, and the scan that
      // prompted this note produced `HideNothing.`, a back-panel slogan, as the
      // name of the product. A brand is set well above its panel's body text
      // (`Minimalist` at 1.83x); a slogan among equals is not.
      .filter((line) => sizeOf(line) >= BRAND_MIN_PROMINENCE)
      .sort((a, b) => sizeOf(b) - sizeOf(a))[0];

    if (brandLine) {
      brandLine.claimedBy = 'brand';
      informational.brand = record('brand', 'Brand', brandLine, brandLine.text);
    }

    /* ── The commodity, by name ──────────────────────────────────────────── */

    const nouns = lines
      .map((line) => ({ line, match: commodityNounIn(line.text) }))
      .filter((entry): entry is { line: Line; match: CommodityMatch } => entry.match !== undefined);

    // Every noun on the label votes on the category, wherever it is printed —
    // the back panel names the commodity as often as the front does.
    const category = categoryFrom(nouns.map((entry) => entry.match));

    /**
     * The printed name comes from the front where the front has one.
     *
     * `MOISTURIZER` is on both panels of this tube, and the back's copy sits
     * higher above its panel's median than the front's does — a comparison
     * that means nothing, because the two panels are set in different sizes
     * for different purposes. The face carrying the brand is the front, and
     * the front is where a package names what it holds.
     */
    const face = brandLine?.region?.imageId;
    const available = nouns.filter((entry) => !entry.line.claimedBy);
    const onFace = available.filter((entry) => entry.line.region?.imageId === face);

    /**
     * A noun that settles the category outranks one that does not, whatever
     * their sizes: `moisturizer` says what the package is and `oil` does not,
     * and on this tube the vaguer word is printed larger.
     */
    const named = (onFace.length > 0 ? onFace : available).sort((a, b) => {
      const classified = Number(b.match.category !== undefined) - Number(a.match.category !== undefined);
      return classified !== 0 ? classified : sizeOf(b.line) - sizeOf(a.line);
    })[0];

    const existing = fields.commodity_name;

    if (named && (!existing || existing.status === 'NOT_FOUND')) {
      named.line.claimedBy = 'commodity_name';
      fields.commodity_name = record(
        'commodity_name',
        'Common or generic name',
        named.line,
        named.match.printed,
      );

      warnings.push(
        `The common or generic name was identified from the word "${named.match.printed}" printed ` +
          'on the package rather than from a labelled declaration. Confirm it against the package.',
      );
    }

    /* ── The two together ────────────────────────────────────────────────── */

    const productName = [informational.brand?.value, fields.commodity_name?.value]
      .filter(Boolean)
      .join(' ')
      .trim();

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

    return category;
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
