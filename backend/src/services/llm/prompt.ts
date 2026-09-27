import { logger } from '../../config/logger';
import { FIELD_SPECS } from '../extraction';

import type { FieldSuggestion, LabelReadingRequest } from './LLMProvider';

/**
 * ── WHAT THE MODEL IS ASKED, AND HOW ITS ANSWER IS READ ─────────────────────
 *
 * One prompt and one parser, shared by every provider.
 *
 * They started inside `GeminiLLMProvider`, which was right while there was one
 * model. With a second, leaving them there would have given the stage two
 * prompts to keep in step and two parsers to harden — and the parser is a
 * trust boundary, not a convenience. A provider is now only the shape of one
 * HTTP call.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Every key the extractor files a value under, engine and informational. */
export const FIELD_KEYS = FIELD_SPECS.map((spec) => spec.field);

/**
 * The declarations, described to the model in its own terms.
 *
 * Generated from `FIELD_SPECS` rather than written out here, so a field added
 * to the extractor is a field this stage can read, with no second list to
 * forget to update.
 */
const FIELD_GLOSSARY = FIELD_SPECS.map((spec) => `  ${spec.field} — ${spec.label}`).join('\n');

/**
 * ── WHY AN ARRAY AND NOT AN OBJECT ──────────────────────────────────────────
 *
 * The obvious schema is one property per declaration. It is also the schema
 * that manufactures MRPs. A model completing `{"mrp": ` has to emit something,
 * and a plausible price is a likelier continuation than `null` — the shape of
 * the request is itself the pressure to invent.
 *
 * A list has no such slot. Finding nothing means returning fewer entries,
 * which is an ordinary completion rather than a refusal to fill a blank. The
 * prompt says the same thing in words, but words are advice and structure is
 * not: this is the half of the defence that holds when the advice is ignored.
 *
 * `enum` on `field` does the other half — a key the extractor does not know
 * cannot come back at all.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          field: { type: 'STRING', enum: FIELD_KEYS },
          value: { type: 'STRING' },
          corrected_from: { type: 'STRING', nullable: true },
        },
        required: ['field', 'value'],
      },
    },
  },
  required: ['findings'],
} as const;

export const SYSTEM_INSTRUCTION = `You are reading OCR output from photographs of a packaged commodity sold in India, taken by a Legal Metrology inspector. The package may be anything sold pre-packed — food, a beverage, a cosmetic, a toiletry, a household product, a medicine, a garment, footwear, stationery, an electronic item, a toy, hardware. Read whatever declarations THIS package carries.

The text is noisy. The camera confuses 0/O, 1/l/I, 5/S, 8/B, rn/m; it drops diacritics from Devanagari; it splits one printed line into two and joins two into one; it reads the same panel differently in each of several photographs. Your job is to find every declaration printed on the package, repair those reading errors, assemble each declaration from however many lines it was split across, and file it under the right name.

Declarations you may report:
${FIELD_GLOSSARY}

Rules:
- Report a declaration ONLY if its value is actually printed in the text. If it is not there, leave it out of the list. An empty list is a correct answer. A missing declaration is exactly what the inspector is looking for, so never fill one in.
- Never infer a value from another value, from the product type, or from what a label of this kind usually carries. You are reading a label, not completing a form.
- Report every declaration you can find, informational ones included — ingredients, batch number, FSSAI licence, expiry date, importer, packer — even where you are not sure a rule needs it.
- Copy the value as printed, in its printed script and language. Do not translate Hindi to English and do not expand abbreviations.
- Where the same declaration appears in more than one photograph, report the clearest and most complete reading once. A truncated read of a value is not a shorter answer, it is a wrong one: prefer "03/2026" over "03/20" and "AAAA557" over "AAAA".
- Prices. Keep the wording a price is printed with — "MRP", "Maximum Retail Price", "inclusive of all taxes" — and the amount. The rupee sign is the character a camera loses most often on an Indian label: where a price carries a stray "?", "T", "7", "2", "R", "z" or "$" standing where the currency sign belongs, write it as ₹ and record the original in corrected_from. Do not add a currency sign to a price that does not show one. A telephone number, a PIN code, a licence number or a date is never a price, whatever sits next to it.
- Unit sale price is a separate declaration from MRP: it is a price PER unit — "₹ 24.00 per kg", "Rs 1.20/ml", "₹ 5 per piece". Report it under unit_sale_price only when the package prints a per-unit price. Do not derive one.
- Net quantity is the amount in the package with its unit — "200 g", "1 L", "500 ml", "1 N", "2 pcs", "1 pair". For an item sold by number (a garment, a pen, a pair of shoes) the count with N, pcs, piece or pair is the net quantity. Keep the unit as printed.
- Dates. Manufacturing / packing date and best-before / use-by / expiry are different declarations; report each under its own name and keep the printed form ("MFD 03/2026", "Best before 12 months from packaging", "EXP 02/2027").
- Manufacturer, packer and importer are the name AND address; assemble the whole address from the lines it wraps across.
- Consumer care is the customer-care phone, e-mail or address printed for complaints.
- Set corrected_from to the original OCR text whenever you changed a character, so an inspector can check the repair. Omit it when you copied the text unchanged.`;

/**
 * The user turn: the OCR text, and the category the inspector recorded.
 *
 * The category is a hint about what to expect and nothing more — the
 * instruction not to invent a declaration stands whatever the category says.
 * It is sent because a model told it is reading a garment stops trying to
 * find an ingredient list in a size chart.
 */
export function promptFor(request: LabelReadingRequest): string {
  const category = request.category ? `\n\nThe inspector recorded this package as: ${request.category}.` : '';
  return `OCR text:\n"""\n${request.text}\n"""${category}`;
}

/** The findings, plus why there were none when the answer itself was at fault. */
export interface ParsedAnswer {
  suggestions: FieldSuggestion[];
  reason?: string;
}

/**
 * The model's JSON, checked at the boundary.
 *
 * Every provider's schema support is a request; this is the enforcement. A key
 * the extractor does not file anything under would otherwise be carried to the
 * report and shown to an inspector as a declaration that does not exist.
 */
export function parseFindings(text: string, inspectionId: string): ParsedAnswer {
  if (text.trim() === '') return { suggestions: [], reason: 'the model returned an empty answer' };

  let parsed: { findings?: unknown };
  try {
    parsed = JSON.parse(text) as { findings?: unknown };
  } catch {
    logger.warn({ inspectionId }, 'LLM skipped: the answer was not JSON');
    return { suggestions: [], reason: 'the answer was not JSON' };
  }

  if (!Array.isArray(parsed.findings)) {
    return { suggestions: [], reason: 'the answer carried no findings list' };
  }

  const known = new Set(FIELD_KEYS);
  const seen = new Set<string>();
  const suggestions: FieldSuggestion[] = [];

  for (const entry of parsed.findings) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { field, value, corrected_from: correctedFrom } = entry as Record<string, unknown>;

    if (typeof field !== 'string' || !known.has(field) || seen.has(field)) continue;
    if (typeof value !== 'string' || value.trim() === '') continue;

    seen.add(field);
    suggestions.push({
      field,
      value: value.trim(),
      correctedFrom: repairIn(correctedFrom, value),
    });
  }

  // An empty list here is a real answer, not a failure: the model read the text
  // and found nothing the extractor had missed.
  return { suggestions };
}

/**
 * The original OCR text, but only where a character actually changed.
 *
 * The prompt asks for `corrected_from` only when the model changed something,
 * and the weaker models fill it in regardless — `gemini-3.5-flash-lite`
 * returns the value back verbatim. Carried through, that reaches the inspector
 * as `500 ml (corrected from "500 ml")`, which invites them to check a repair
 * that never happened and quietly devalues the annotation on the lines where a
 * repair did.
 *
 * Whitespace alone does not count. A value assembled from two wrapped lines
 * has had no character repaired, and there is nothing on it to verify.
 */
function repairIn(correctedFrom: unknown, value: string): string | undefined {
  if (typeof correctedFrom !== 'string' || correctedFrom.trim() === '') return undefined;
  const bare = (text: string): string => text.replace(/\s+/g, ' ').trim();
  return bare(correctedFrom) === bare(value) ? undefined : correctedFrom.trim();
}
