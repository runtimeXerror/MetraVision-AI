/**
 * ── THE LLM SEAM ────────────────────────────────────────────────────────────
 *
 * A language model reads the OCR text and says what it thinks the declarations
 * are. Nothing downstream of this file learns which model, which vendor, or
 * whether one ran at all.
 *
 * The seam exists for the same reason `OCRProvider` does — this is the part of
 * the system most likely to be swapped. A local Qwen behind an HTTP call, a
 * different hosted API, or nothing: each is one class beside this file and one
 * value in `LLM_PROVIDER`.
 *
 *      LLMProvider
 *      ├── GeminiLLMProvider   (hosted, current)
 *      ├── NoopLLMProvider     (disabled — the default, and what CI runs)
 *      └── <LocalLLMProvider>  (a small model behind the sidecar pattern)
 *
 * ── WHAT THIS STAGE DOES ────────────────────────────────────────────────────
 *
 * It reads the label. Given the OCR text of every photograph, it says which
 * declarations are printed on the package and what each one says — with the
 * camera's damage repaired: `5OO g` to `500 g`, `४५` to `45`, a rupee sign the
 * recogniser turned into a `?`, an address reassembled from the four lines it
 * wrapped across.
 *
 * Its reading is what the rule engine evaluates. See `adoptReading` for how
 * the reading is tied back to the OCR lines it came from, so every value on
 * the record still points at a box on a photograph.
 *
 * It may not decide anything about the law. A model asked to fill a schema
 * will fill it, which is why the answer is a *list* of findings and not an
 * object with a slot per declaration — a label with no MRP printed on it is
 * answered with a shorter list, not a plausible price. See `prompt.ts`.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** What the model is asked to read. */
export interface LabelReadingRequest {
  /**
   * The OCR text, verbatim — not normalised, not repaired.
   *
   * The whole value of this stage is that it sees the damage. Handing it text
   * the extractor has already cleaned would ask it to correct errors that were
   * corrected, and hide the ones that were not.
   */
  text: string;
  /**
   * The category the inspector recorded, as a hint about what to expect.
   * Never a licence to invent a declaration the text does not carry.
   */
  category?: string;
  /** Carried into the log line so a suggestion can be traced to its scan. */
  inspectionId: string;
}

/** One declaration the model claims to have found. */
export interface FieldSuggestion {
  /** A key from `FIELD_SPECS` — anything else is dropped on the way in. */
  field: string;
  /** The value as the model would have it read. */
  value: string;
  /**
   * The OCR text this was read from, verbatim, when the model changed it.
   *
   * The point of the whole stage, and the only way an inspector can check the
   * correction: `5OO g → 500 g` is reviewable, a bare `500 g` is not.
   */
  correctedFrom?: string;
}

export interface LabelReading {
  /** Provider key recorded on the inspection, e.g. `gemini`. */
  provider: string;
  /** The exact model string that answered. Pinned in the audit record. */
  model: string;
  suggestions: FieldSuggestion[];
  processingTimeMs: number;
  /**
   * True when this call failed for a reason another model might not share.
   *
   * A day's free-tier quota is spent, the service returned a 503, the socket
   * never opened: none of those is a statement about the label, and a second
   * model would answer. `FallbackLLMProvider` moves on when it sees this.
   *
   * A model that answered and found nothing, or answered with something
   * unparseable, is not retryable — the first is a real result and the second
   * will not improve by being asked again somewhere else.
   */
  retryable?: boolean;
}

/**
 * What happened on the most recent call.
 *
 * Kept because this stage fails silently by design, and a stage that fails
 * silently needs somewhere to say so. `configured: true` only means a key is
 * present — it does not mean the key is valid, that the quota is unspent, or
 * that the model answered. Between "the LLM is on" and "the LLM is working"
 * sits every scan that quietly ran without it, and this is the difference.
 */
export interface LLMOutcome {
  at: string;
  ok: boolean;
  /** Why the call produced nothing. Absent when it succeeded. */
  reason?: string;
  suggestions: number;
  /** Suggestions where a character was actually repaired. */
  corrections: number;
  ms: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** The most recent call's outcome. Absent until one has run. */
  lastOutcome?(): LLMOutcome | undefined;
  /**
   * Reads the text. Never throws for an outage, a timeout or a malformed
   * answer — it returns no suggestions and logs.
   *
   * The opposite of `OCRProvider.extractText`, and deliberately so. A failed
   * OCR means the scan has no evidence and must stop. A failed LLM call means
   * the scan proceeds on the deterministic extractor's reading, which has
   * already run: the rule engine has its input and the report is complete,
   * and says which reader it was. A stage that can fail the scan is worse
   * than no stage at all.
   */
  read(request: LabelReadingRequest): Promise<LabelReading>;
  isConfigured(): boolean;
  configurationHint(): string | null;
}
