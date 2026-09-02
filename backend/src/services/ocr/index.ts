import { env } from '../../config/env';

import { GeminiOCRProvider } from './GeminiOCRProvider';
import { GoogleVisionOCRProvider } from './GoogleVisionOCRProvider';
import { MockOCRProvider, type MockFixtureId } from './MockOCRProvider';
import type { OCRProvider } from './OCRProvider';

/**
 * Provider resolution.
 *
 * Adding the benchmarked model later is one `case` here and one class beside
 * this file. Nothing else in the codebase learns about it — see the note at the
 * top of `OCRProvider.ts`.
 */
function createProvider(): OCRProvider {
  switch (env.OCR_PROVIDER) {
    case 'google':
      return new GoogleVisionOCRProvider();
    case 'gemini':
      return new GeminiOCRProvider();
    case 'mock':
    default:
      return new MockOCRProvider();
  }
}

export const ocrProvider: OCRProvider = createProvider();

/** Lets a test or the seed script pin a specific fixture deterministically. */
export function mockProviderFor(fixture: MockFixtureId): OCRProvider {
  return new MockOCRProvider(fixture);
}

export { GeminiOCRProvider } from './GeminiOCRProvider';
export { GoogleVisionOCRProvider } from './GoogleVisionOCRProvider';
export { MockOCRProvider, FailingOCRProvider, mockFixtures, MOCK_FIXTURE_IDS } from './MockOCRProvider';
export type { MockFixtureId } from './MockOCRProvider';
export { aggregate } from './OCRProvider';
export type {
  AggregateOCRResult,
  OCRBoundingBox,
  OCRImageInput,
  OCRProvider,
  OCRRegion,
  OCRRegionKind,
  OCRResult,
} from './OCRProvider';
