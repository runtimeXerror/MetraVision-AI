import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';

import type { OCRImageInput, OCRProvider, OCRRegion, OCRResult } from './OCRProvider';

/**
 * ── GEMINI FLASH ────────────────────────────────────────────────────────────
 *
 * A vision-language model reading the label instead of a dedicated OCR engine.
 *
 * Worth having, because on Indian packaging a VLM is genuinely better at the
 * things that break classical OCR: curved and foil surfaces, text at an angle,
 * mixed Devanagari and Latin in one line, and the small dense block where the
 * manufacturer's address sits. It reads for meaning rather than glyph by glyph,
 * so it recovers lines that Vision returns as fragments.
 *
 * ── What it costs, and why it matters here ─────────────────────────────────
 *
 * **No bounding boxes.** The model returns text, not geometry. Every evidence
 * reference from this provider therefore has no `bbox`, so an inspector cannot
 * tap a finding and see it highlighted on the photograph. On a screen whose
 * whole purpose is that a finding can be checked against the package, that is a
 * real loss, not a cosmetic one.
 *
 * **No confidence.** There is no per-reading score, and one is *not* invented
 * here. The rule engine reads an absent confidence as "reliability unknown" and
 * routes failed checks to REVIEW rather than recording them as violations — so
 * this provider produces a more cautious system, with more findings sent to a
 * person. That is the correct behaviour and it is deliberate; see
 * `DecisionEngine`.
 *
 * **It can be wrong fluently.** An OCR engine handed an illegible price returns
 * nothing or garbage. A language model can return a plausible, well-formed
 * price that is not on the package — and downstream, that is indistinguishable
 * from a real reading. The prompt below is written to suppress it (transcribe,
 * never infer, omit what cannot be read) but the risk does not go to zero, and
 * it is the reason nothing in this file reports confidence.
 *
 * Use it where recall matters more than provenance. Where a finding has to be
 * defended against the photograph, Vision's boxes are worth more.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The transcription instruction.
 *
 * Every clause is load-bearing:
 *
 * · "verbatim" and "exactly as printed" — the values are fed to validators that
 *   test wording. Rule 6(1)(e) as it stood 2018–2024 required the declaration
 *   to *say* "maximum retail price"; a model that tidies "M.R.P." into "MRP",
 *   or ₹ into Rs., changes what the rule sees.
 * · "one line per printed line" — the extractor's label/value patterns work a
 *   line at a time, and a reflowed paragraph merges declarations.
 * · "do not translate" — a Hindi declaration transcribed into English is no
 *   longer the text on the package.
 * · "omit anything you cannot read" — the single most important clause. A
 *   guessed price is worse than a missing one: a missing one becomes a review,
 *   a guessed one becomes a finding.
 * · "no commentary" — anything conversational lands in `rawText` and is then
 *   pattern-matched as though it were printed on the label.
 */
const PROMPT = [
  'Transcribe every piece of text printed on this product package, verbatim.',
  '',
  'Rules:',
  '- Output only the transcription. No preamble, no commentary, no markdown.',
  '- One line of output per line of printed text, in reading order.',
  '- Reproduce text exactly as printed, including punctuation, currency symbols,',
  '  abbreviations and spacing. Do not correct, expand, normalise or reformat.',
  '- Do not translate. Keep Devanagari, Tamil, Telugu, Bengali and other scripts',
  '  in their original script.',
  '- If part of the label is blurred, cut off or otherwise unreadable, omit that',
  '  part. Never guess at a value, and never infer one from context.',
  '- If no text is legible at all, output nothing.',
].join('\n');

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiOCRProvider implements OCRProvider {
  readonly name = 'gemini';
  readonly version = `${env.GEMINI_MODEL}`;

  isConfigured(): boolean {
    return Boolean(env.OCR_API_KEY);
  }

  configurationHint(): string | null {
    if (this.isConfigured()) return null;
    return 'Gemini needs OCR_API_KEY set to a Google AI Studio API key (https://aistudio.google.com/apikey). See backend/.env.example.';
  }

  async extractText(image: OCRImageInput): Promise<OCRResult> {
    const hint = this.configurationHint();
    if (hint) throw new ApiError(503, 'OCR_NOT_CONFIGURED', hint);

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.OCR_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${ENDPOINT}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.OCR_API_KEY!)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { inline_data: { mime_type: image.mimeType, data: image.buffer.toString('base64') } },
                  { text: PROMPT },
                ],
              },
            ],
            generationConfig: {
              // Zero temperature: this is a transcription, and the same
              // photograph should read the same way twice. An inspection is
              // evidence, and a verdict that changes between runs is not.
              temperature: 0,
              maxOutputTokens: 2048,
            },
          }),
        },
      );

      if (!response.ok) {
        throw errorFor(response.status, await safeText(response));
      }

      const body = (await response.json()) as GenerateContentResponse;

      if (body.error) throw errorFor(body.error.code ?? 500, body.error.message ?? 'unknown');

      /**
       * A safety block is not an empty label.
       *
       * Returning "" here would hand the rule engine a package with no
       * declarations on it, which is the one thing the pipeline must never do
       * on a failed read — see §31 and `scanService`.
       */
      if (body.promptFeedback?.blockReason) {
        logger.error({ reason: body.promptFeedback.blockReason }, 'Gemini blocked the image');
        throw new ApiError(
          503,
          'OCR_FAILED',
          'The OCR service declined to process this image. Try another photograph.',
        );
      }

      const candidate = body.candidates?.[0];

      // `MAX_TOKENS` means the transcription was cut off mid-label. Half a
      // label read as a whole one would report the declarations past the cut
      // as absent, which is a finding against a trader for a truncated reply.
      if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
        throw new ApiError(503, 'OCR_FAILED', 'The OCR service could not complete the reading.');
      }
      if (candidate?.finishReason === 'MAX_TOKENS') {
        logger.warn({ imageId: image.imageId }, 'Gemini transcription hit the output limit');
      }

      const rawText = (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      const regions: OCRRegion[] = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((text) => ({
          text,
          // No bbox and no confidence, and neither is invented. See the header.
          kind: 'LINE' as const,
          imageId: image.imageId,
        }));

      return {
        rawText,
        regions,
        provider: this.name,
        providerVersion: this.version,
        processingTimeMs: Date.now() - startedAt,
        confidenceAvailable: false,
        imageId: image.imageId,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(
          504,
          'OCR_TIMEOUT',
          `The OCR service did not respond within ${Math.round(env.OCR_TIMEOUT_MS / 1000)} seconds. Please try again.`,
        );
      }

      // Only the error's name: its message can carry the request URL, and the
      // request URL carries the API key.
      logger.error({ err: error instanceof Error ? error.name : 'unknown' }, 'Gemini request failed');
      throw new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Never let a provider error body reach a user — it can echo the request URL. */
async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return '';
  }
}

function errorFor(status: number, detail: string): ApiError {
  logger.error({ status, detail }, 'Gemini returned an error');

  if (status === 401 || status === 403) {
    return new ApiError(
      503,
      'OCR_AUTH_FAILED',
      'The OCR service rejected the configured API key. Check OCR_API_KEY.',
    );
  }
  if (status === 429) {
    return new ApiError(
      503,
      'OCR_QUOTA_EXCEEDED',
      'The OCR service rate limit has been reached. Please try again shortly.',
    );
  }
  if (status === 400) {
    return new ApiError(
      422,
      'OCR_IMAGE_REJECTED',
      'The OCR service could not read this image. Try a clearer photograph.',
    );
  }
  return new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.');
}
