import { env } from '../../config/env';
import { logger } from '../../config/logger';

import type {
  LabelReading,
  LabelReadingRequest,
  FieldSuggestion,
  LLMOutcome,
  LLMProvider,
} from './LLMProvider';
import { parseFindings, promptFor, SYSTEM_INSTRUCTION } from './prompt';

/**
 * ── GROQ ────────────────────────────────────────────────────────────────────
 *
 * Second in the chain, and it is there for one job: to answer when Google will
 * not. The free tier for a Gemini flash model is twenty requests a *day*, and
 * an inspector on a shift can spend that before lunch — after which every scan
 * ran with the stage silently skipped, which is the failure this file exists
 * to end.
 *
 * Groq serves open-weight models on its own hardware behind an OpenAI-shaped
 * API, with an allowance measured in thousands of requests a day rather than
 * tens. The default is Llama 3.3 70B: large enough to repair OCR damage and to
 * hold a JSON schema, and not a reasoning model, which matters because this
 * task wants a transcription and not a deliberation.
 *
 * ── WHAT IS DIFFERENT FROM GEMINI, AND WHAT IS NOT ─────────────────────────
 *
 * Not the prompt, and not the parser. Both live in `prompt.ts` and both models
 * are held to the same instruction and the same boundary check, so a
 * suggestion cannot be traced to which vendor happened to answer.
 *
 * What differs is only the shape of the call: a chat-completions body instead
 * of `contents`, a bearer token instead of a header key, and JSON mode instead
 * of a response schema — Groq's JSON mode guarantees syntactically valid JSON
 * but not the shape of it, so `parseFindings` does the enforcing. It already
 * did: the schema was always the model's instruction and never the trust
 * boundary.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * JSON mode returns valid JSON of whatever shape the model chose, so the shape
 * has to be asked for in words. Gemini takes `RESPONSE_SCHEMA` instead; both
 * end at the same `parseFindings`.
 */
const JSON_SHAPE = `Answer with a JSON object of exactly this shape and nothing else:
{"findings":[{"field":"<one of the declaration keys above>","value":"<as printed>","corrected_from":"<original OCR text, omit when unchanged>"}]}
An empty findings array is a valid and often correct answer.`;

export class GroqLLMProvider implements LLMProvider {
  readonly name = 'groq';
  readonly model: string;

  #last: LLMOutcome | undefined;

  constructor(model: string = env.GROQ_MODEL) {
    this.model = model;
  }

  lastOutcome(): LLMOutcome | undefined {
    return this.#last;
  }

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
    return Boolean(env.GROQ_API_KEY);
  }

  configurationHint(): string | null {
    if (this.isConfigured()) return null;
    return 'Set GROQ_API_KEY to a Groq Cloud key (https://console.groq.com/keys).';
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
      logger.warn({ inspectionId: request.inspectionId }, 'LLM skipped: GROQ_API_KEY is not set');
      return done([], 'GROQ_API_KEY is not set', true);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GROQ_API_KEY as string}`,
        },
        body: JSON.stringify({
          model: this.model,
          // Deterministic, for the same reason as Gemini: two scans of one
          // photograph that disagree make the audit record unreproducible.
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${SYSTEM_INSTRUCTION}\n\n${JSON_SHAPE}` },
            { role: 'user', content: promptFor(request) },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
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

      const body = (await response.json()) as GroqResponse;
      const choice = body.choices?.[0];

      // `length` means the answer was cut off mid-JSON, which parses to
      // nothing. Another model may have room where this one ran out.
      if (choice?.finish_reason && choice.finish_reason !== 'stop') {
        logger.warn(
          { inspectionId: request.inspectionId, model: this.model, why: choice.finish_reason },
          'LLM: the answer did not complete',
        );
        return done([], `the answer did not complete (${choice.finish_reason})`, true);
      }

      const { suggestions, reason } = parseFindings(
        choice?.message?.content ?? '',
        request.inspectionId,
      );

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
interface GroqResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
}
