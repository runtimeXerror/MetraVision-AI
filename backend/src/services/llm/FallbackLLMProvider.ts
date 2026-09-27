import { logger } from '../../config/logger';

import type { LabelReading, LabelReadingRequest, LLMOutcome, LLMProvider } from './LLMProvider';

/**
 * ── WHEN ONE ALLOWANCE RUNS OUT, THE NEXT ONE ANSWERS ───────────────────────
 *
 * A chain of models tried in order, first to answer wins.
 *
 * The stage was built around a single provider and failed the way a single
 * provider fails: quietly, and all at once. The free tier for a Gemini flash
 * model is twenty requests a day. A morning spent running the corpus spent
 * them, and from then until midnight every inspection scanned in the field ran
 * with the model skipped — the log said so, in a line nobody was reading,
 * while the reports came out as though the stage had never existed.
 *
 * One vendor's free tier is not a foundation. Two are not either, but the
 * failure of one stops being the failure of the stage.
 *
 * ── WHAT COUNTS AS "TRY THE NEXT ONE" ──────────────────────────────────────
 *
 * Only `retryable` on the reading. A spent quota, a 503, a socket that never
 * opened, an answer cut off half-written: none of those is a statement about
 * the label, and the next model will do the work.
 *
 * A model that answered and found nothing is *not* retryable, and this is the
 * important half. An empty list is a real result — the text carried nothing
 * the extractor had missed — and asking a second model the same question until
 * one of them says something is not a fallback, it is shopping for an answer.
 * A compliance record cannot be assembled that way.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class FallbackLLMProvider implements LLMProvider {
  readonly #chain: LLMProvider[];

  /** The provider that answered last, so `name`, `model` and the outcome are its. */
  #answered: LLMProvider | undefined;

  constructor(chain: LLMProvider[]) {
    if (chain.length === 0) throw new Error('FallbackLLMProvider needs at least one provider');
    this.#chain = chain;
  }

  /** Every entry, in order — for `/health`, which should show the whole chain. */
  get chain(): readonly LLMProvider[] {
    return this.#chain;
  }

  get name(): string {
    return (this.#answered ?? this.#first()).name;
  }

  get model(): string {
    return (this.#answered ?? this.#first()).model;
  }

  lastOutcome(): LLMOutcome | undefined {
    return this.#answered?.lastOutcome?.();
  }

  /** Configured if any entry is: one usable key is enough to run the stage. */
  isConfigured(): boolean {
    return this.#chain.some((provider) => provider.isConfigured());
  }

  configurationHint(): string | null {
    if (this.isConfigured()) return null;
    return this.#chain
      .map((provider) => provider.configurationHint())
      .filter((hint): hint is string => hint !== null)
      .join(' ');
  }

  async read(request: LabelReadingRequest): Promise<LabelReading> {
    let last: LabelReading | undefined;

    for (const provider of this.#chain) {
      // An entry with no key is not a failure to log on every scan — it is a
      // chain that was configured with more options than this deployment has.
      if (!provider.isConfigured()) continue;

      const reading = await provider.read(request);
      this.#answered = provider;
      last = reading;

      if (!reading.retryable) return reading;

      logger.info(
        {
          inspectionId: request.inspectionId,
          provider: provider.name,
          model: provider.model,
          reason: provider.lastOutcome?.()?.reason,
        },
        'LLM: falling through to the next model',
      );
    }

    if (last) return last;

    // Nothing in the chain had a key. Reported as the first entry's problem,
    // because its hint is the one an operator should act on.
    const first = this.#first();
    logger.warn(
      { inspectionId: request.inspectionId },
      'LLM skipped: no model in the chain is configured',
    );
    this.#answered = first;

    return {
      provider: first.name,
      model: first.model,
      suggestions: [],
      processingTimeMs: 0,
      retryable: true,
    };
  }

  #first(): LLMProvider {
    return this.#chain[0]!;
  }
}
