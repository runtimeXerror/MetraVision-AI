import type { LabelReading, LabelReadingRequest, LLMProvider } from './LLMProvider';

/**
 * No model. The default, and what CI runs.
 *
 * Present rather than making the whole stage conditional, so `runScan` has one
 * code path instead of two. A provider that returns nothing exercises the same
 * branch as a provider whose call failed, which is the branch that has to keep
 * working — an optional stage is only optional if the pipeline is tested
 * without it.
 */
export class NoopLLMProvider implements LLMProvider {
  readonly name = 'none';
  readonly model = 'none';

  async read(_request: LabelReadingRequest): Promise<LabelReading> {
    return { provider: this.name, model: this.model, suggestions: [], processingTimeMs: 0 };
  }

  isConfigured(): boolean {
    return true;
  }

  configurationHint(): string | null {
    return null;
  }
}
