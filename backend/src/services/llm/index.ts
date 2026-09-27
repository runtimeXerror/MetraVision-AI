import { env } from '../../config/env';

import { FallbackLLMProvider } from './FallbackLLMProvider';
import { GeminiLLMProvider } from './GeminiLLMProvider';
import { GroqLLMProvider } from './GroqLLMProvider';
import type { LLMProvider } from './LLMProvider';
import { NoopLLMProvider } from './NoopLLMProvider';

/**
 * Provider resolution.
 *
 * Another vendor is one `case` here and one class beside this file — the same
 * arrangement as `services/ocr/`. A local model would be a `LocalLLMProvider`
 * pointed at a sidecar, and nothing in `runScan` would change.
 */
function providerFor(entry: string): LLMProvider | null {
  const [vendor, ...rest] = entry.split(':');
  const model = rest.join(':').trim();

  switch (vendor?.trim().toLowerCase()) {
    case 'gemini':
      return new GeminiLLMProvider(model === '' ? undefined : model);
    case 'groq':
      return new GroqLLMProvider(model === '' ? undefined : model);
    default:
      return null;
  }
}

/**
 * The chain, from `LLM_CHAIN` if it is set and from `LLM_PROVIDER` if it is not.
 *
 * Both are read rather than one replacing the other, so a deployment carrying
 * the older single-provider setting keeps working exactly as it did until
 * somebody writes a chain.
 */
function createProvider(): LLMProvider {
  const entries = env.LLM_CHAIN.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && entry.toLowerCase() !== 'none');

  const chain =
    entries.length > 0
      ? entries.map(providerFor).filter((provider): provider is LLMProvider => provider !== null)
      : env.LLM_PROVIDER === 'gemini'
        ? [new GeminiLLMProvider()]
        : [];

  if (chain.length === 0) return new NoopLLMProvider();
  if (chain.length === 1) return chain[0]!;
  return new FallbackLLMProvider(chain);
}

export const llmProvider: LLMProvider = createProvider();

/** True when a model was asked for and at least one entry is actually usable. */
export function llmEnabled(): boolean {
  return !(llmProvider instanceof NoopLLMProvider) && llmProvider.isConfigured();
}

export { FallbackLLMProvider } from './FallbackLLMProvider';
export { GeminiLLMProvider } from './GeminiLLMProvider';
export { GroqLLMProvider } from './GroqLLMProvider';
export { NoopLLMProvider } from './NoopLLMProvider';
export { adoptReading } from './adoptReading';
export type {
  FieldSuggestion,
  LabelReading,
  LabelReadingRequest,
  LLMProvider,
} from './LLMProvider';
