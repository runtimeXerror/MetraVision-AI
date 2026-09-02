import { env } from '../../config/env';

import { GoogleVisionOCRProvider } from './GoogleVisionOCRProvider';
import { MockOCRProvider, type MockFixtureId } from './MockOCRProvider';
import type { OCRProvider } from './OCRProvider';
import { PaddleOCRProvider } from './PaddleOCRProvider';

/**
 * Provider resolution.
 *
 * Adding another engine is one `case` here and one class beside this file.
 * Nothing else in the codebase learns about it — see the note at the top of
 * `OCRProvider.ts`.
 */
function createProvider(): OCRProvider {
  switch (env.OCR_PROVIDER) {
    case 'paddle':
      return new PaddleOCRProvider();
    case 'google':
      return new GoogleVisionOCRProvider();
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

export { GoogleVisionOCRProvider } from './GoogleVisionOCRProvider';
export { PaddleOCRProvider, resetPaddleVersionCache } from './PaddleOCRProvider';
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
