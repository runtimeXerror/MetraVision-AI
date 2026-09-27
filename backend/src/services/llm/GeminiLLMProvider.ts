import { env } from '../../config/env';
import { logger } from '../../config/logger';

import type {
  LabelReading,
  LabelReadingRequest,
  FieldSuggestion,
  LLMOutcome,
  LLMProvider,
} from './LLMProvider';
import { parseFindings, promptFor, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION } from './prompt';

/**
 * ── GEMINI ──────────────────────────────────────────────────────────────────
 *
 * Google's Generative Language API, over plain `fetch`. No SDK: the call is
 * one POST with a JSON body, and a dependency that wraps it would be a
 * dependency to keep current for no gain — the same reasoning that keeps
 * `GoogleVisionOCRProvider` on `fetch`.
 *
 * First in the chain for one reason: the labels are bilingual. A Legal
 * Metrology declaration is printed in Hindi or English and usually both, and
 * correcting `निर्माण तिथि` or `५०० ग्राम` requires a model that has actually
 * seen Devanagari.
 *
 * The model is a constructor argument rather than read from the environment,
 * because the chain in `index.ts` lists this provider more than once — a model
 * with a generous daily allowance ahead of a stronger one kept for when the
 * first has been spent. See `FallbackLLMProvider`.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiLLMProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly model: string;

  #last: LLMOutcome | undefined;

  constructor(model: string = env.GEMINI_MODEL) {
    this.model = model;
  }

  lastOutcome(): LLMOutcome | undefined {
    return this.#last;
  }

  /** Records what happened, so `/health` can say whether the stage is working. */
  #record(ms: number, suggestions: FieldSuggestion[], reason?: string): void {
    this.#last = {
      at: new Date().toISOString(),
      ok: reason === undefined,
      reason,
      suggestions: suggestions.length,
      corrections: suggestions.filter((one) => one.correctedFrom).length,
      ms,
    };
  }

  isConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  configurationHint(): string | null {
    if (this.isConfigured()) return null;
    return 'Set GEMINI_API_KEY to a Google AI Studio key (https://aistudio.google.com/apikey).';
  }

  async read(request: LabelReadingRequest): Promise<LabelReading> {
    const startedAt = Date.now();
    const done = (
      suggestions: FieldSuggestion[],
      reason?: string,
      retryable = false,
    ): LabelReading => {
      const ms = Date.now() - startedAt;
      this.#record(ms, suggestions, reason);
      return {
        provider: this.name,
        model: this.model,
        suggestions,
        processingTimeMs: ms,
        retryable,
      };
    };

    if (!this.isConfigured()) {
      logger.warn({ inspectionId: request.inspectionId }, 'LLM skipped: GEMINI_API_KEY is not set');
      return done([], 'GEMINI_API_KEY is not set', true);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS);

    try {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY as string,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: promptFor(request) }] }],
          generationConfig: {
            // Deterministic on purpose. Two scans of the same photograph that
            // disagree would make the audit record unreproducible, and this
            // stage has no use for variety.
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');

        /*
         * Which failures the next model in the chain can answer.
         *
         * A spent quota, an overloaded service and a model Google has retired
         * are all about this endpoint rather than about the label, and the
         * entry below in the chain will do the work. A 400 is this request
         * being malformed; repeating it elsewhere would spend a second
         * allowance to get the same answer.
         */
        const retryable =
          response.status === 429 || response.status === 404 || response.status >= 500;

        logger.warn(
          {
            inspectionId: request.inspectionId,
            status: response.status,
            model: this.model,
            detail: detail.slice(0, 300),
          },
          response.status === 429
            ? 'LLM: rate limited (free tier quota)'
            : 'LLM: the model returned an error',
        );

        return done(
          [],
          response.status === 429
            ? 'rate limited (free tier quota)'
            : `the model returned HTTP ${response.status}`,
          retryable,
        );
      }

      const body = (await response.json()) as GeminiResponse;
      const candidate = body.candidates?.[0];

      if (
        body.promptFeedback?.blockReason ||
        (candidate?.finishReason && candidate.finishReason !== 'STOP')
      ) {
        const why = body.promptFeedback?.blockReason ?? candidate?.finishReason;
        logger.warn(
          { inspectionId: request.inspectionId, model: this.model, why },
          'LLM: the answer did not complete',
        );
        // A second model need not stop where this one did.
        return done([], `the answer did not complete (${why})`, true);
      }

      const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      const { suggestions, reason } = parseFindings(text, request.inspectionId);

      logger.info(
        {
          inspectionId: request.inspectionId,
          model: this.model,
          suggestions: suggestions.length,
          corrections: suggestions.filter((one) => one.correctedFrom).length,
          ms: Date.now() - startedAt,
        },
        'LLM read complete',
      );

      return done(suggestions, reason);
    } catch (error) {
      // Deliberately swallowed — see the contract on `LLMProvider.read`. The
      // scan is already complete without this stage; a network blip here must
      // not cost an inspector the reading they are standing in a shop to get.
      const aborted = error instanceof Error && error.name === 'AbortError';
      logger.warn(
        { inspectionId: request.inspectionId, model: this.model, err: error },
        aborted ? 'LLM: timed out' : 'LLM: the call failed',
      );
      return done(
        [],
        aborted ? `timed out after ${env.LLM_TIMEOUT_MS} ms` : 'the call failed (network or DNS)',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Only the parts of the response this provider reads. */
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}
