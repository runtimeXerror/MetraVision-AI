import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaddleOCRProvider, resetPaddleVersionCache } from '../src/services/ocr';
import { ApiError } from '../src/utils/ApiError';

/**
 * ── THE PADDLEOCR PROVIDER ──────────────────────────────────────────────────
 *
 * The sidecar is stubbed rather than started. These tests are about the
 * translation — sidecar JSON into `OCRResult` — and about the failure
 * taxonomy, neither of which should need a gigabyte of model weights, a Python
 * interpreter or three seconds per case to assert.
 *
 * The engine itself is exercised separately, against real images, by the
 * Python suite in `ocr-service/tests/`.
 *
 * The distinctions being defended here are the ones that decide whether a
 * trader gets a finding recorded against them:
 *
 *   · a read that found nothing must NOT be an error, and must NOT be
 *     confused with a read that failed;
 *   · a read that failed must NOT arrive downstream as an empty label;
 *   · a confidence the engine did not supply must never be invented.
 * ────────────────────────────────────────────────────────────────────────────
 */

const IMAGE = { imageId: 'img_1', buffer: Buffer.from('fake-jpeg-bytes'), mimeType: 'image/jpeg' };

/** A representative sidecar success body. */
function sidecarBody(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    fullText: 'Net Quantity: 5 kg\nMRP ₹315.00',
    lines: [
      {
        text: 'Net Quantity: 5 kg',
        confidence: 0.97,
        boundingBox: { x: 65, y: 222, width: 279, height: 48 },
        polygon: [
          [65, 222],
          [344, 226],
          [343, 270],
          [65, 265],
        ],
      },
      {
        text: 'MRP ₹315.00',
        confidence: 0.99,
        boundingBox: { x: 66, y: 283, width: 483, height: 41 },
      },
    ],
    metadata: {
      imageWidth: 900,
      imageHeight: 1200,
      processingTimeMs: 2359,
      engine: 'paddleocr',
      engineVersion: 'en_PP-OCRv5_mobile_rec/paddleocr-3.7.0',
      languages: ['en'],
      preprocessing: [],
      lineCount: 2,
      meanConfidence: 0.98,
    },
    ...overrides,
  };
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

/** The shape undici raises when nothing is listening on the port. */
function refuseConnection(): void {
  const error = new TypeError('fetch failed');
  (error as { cause?: { code: string } }).cause = { code: 'ECONNREFUSED' };
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
}

describe('PaddleOCRProvider', () => {
  beforeEach(() => {
    resetPaddleVersionCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('configuration', () => {
    it('is configured without any credential', () => {
      const provider = new PaddleOCRProvider();

      // The whole point of the local engine: there is no key to forget.
      expect(provider.isConfigured()).toBe(true);
      expect(provider.configurationHint()).toBeNull();
    });
  });

  describe('a successful read', () => {
    it('translates the sidecar response into an OCRResult', async () => {
      respondWith(sidecarBody());

      const result = await new PaddleOCRProvider().extractText(IMAGE);

      expect(result.provider).toBe('paddleocr');
      expect(result.rawText).toBe('Net Quantity: 5 kg\nMRP ₹315.00');
      expect(result.imageId).toBe('img_1');
      expect(result.imageSize).toEqual({ width: 900, height: 1200 });
      expect(result.regions).toHaveLength(2);
      expect(result.processingTimeMs).toBe(2359);
    });

    it('converts {x, y, width, height} into the [x1, y1, x2, y2] evidence box', async () => {
      respondWith(sidecarBody());

      const result = await new PaddleOCRProvider().extractText(IMAGE);

      // 65 + 279 = 344, 222 + 48 = 270. An overlay drawn from the wrong
      // convention lands in the wrong place on the photograph.
      expect(result.regions[0]?.boundingBox).toEqual([65, 222, 344, 270]);
      expect(result.regions[0]?.kind).toBe('LINE');
    });

    it('carries every confidence through and reports that they exist', async () => {
      respondWith(sidecarBody());

      const result = await new PaddleOCRProvider().extractText(IMAGE);

      expect(result.regions.map((region) => region.confidence)).toEqual([0.97, 0.99]);
      // Read by DecisionEngine: with confidence available, a failed check can
      // become a violation rather than a review.
      expect(result.confidenceAvailable).toBe(true);
    });

    it('never invents a confidence the engine did not supply', async () => {
      respondWith(
        sidecarBody({
          lines: [{ text: 'MRP ₹315.00', boundingBox: { x: 1, y: 2, width: 3, height: 4 } }],
        }),
      );

      const result = await new PaddleOCRProvider().extractText(IMAGE);

      expect(result.regions[0]?.confidence).toBeUndefined();
      expect(result.confidenceAvailable).toBe(false);
    });

    it('records the engine version for the audit trail', async () => {
      respondWith(sidecarBody());

      const result = await new PaddleOCRProvider().extractText(IMAGE);

      expect(result.providerVersion).toBe('en_PP-OCRv5_mobile_rec/paddleocr-3.7.0');
    });

    it('drops blank lines rather than passing empty declarations downstream', async () => {
      respondWith(
        sidecarBody({
          lines: [{ text: '   ', confidence: 0.4 }, { text: 'MRP ₹315.00', confidence: 0.9 }],
        }),
      );

      const result = await new PaddleOCRProvider().extractText(IMAGE);

      expect(result.regions).toHaveLength(1);
      expect(result.regions[0]?.text).toBe('MRP ₹315.00');
    });
  });

  describe('a read that found nothing', () => {
    it('returns an empty result instead of throwing', async () => {
      // A photograph of a blank surface legitimately reads as nothing. Raising
      // here would make an unlabelled package indistinguishable from an
      // outage; deciding what an empty read means across every image belongs
      // to scanService, which is the only place that knows how many there were.
      respondWith(sidecarBody({ fullText: '', lines: [], metadata: { lineCount: 0 } }));

      const result = await new PaddleOCRProvider().extractText(IMAGE);

      expect(result.rawText).toBe('');
      expect(result.regions).toEqual([]);
      expect(result.confidenceAvailable).toBe(false);
    });
  });

  describe('failures', () => {
    it('reports an unreadable image as a 422 the inspector can act on', async () => {
      respondWith({ success: false, error: 'The image is corrupted or truncated.' }, 400);

      await expect(new PaddleOCRProvider().extractText(IMAGE)).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'OCR_IMAGE_REJECTED',
      });
    });

    it('reports an oversized image as a 422', async () => {
      respondWith({ success: false, error: 'The image exceeds the 12 MB limit.' }, 413);

      await expect(new PaddleOCRProvider().extractText(IMAGE)).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'OCR_IMAGE_REJECTED',
      });
    });

    it('reports a broken engine as a 503, not as an empty label', async () => {
      respondWith({ success: false, error: 'The OCR engine is not available.' }, 503);

      const error = await new PaddleOCRProvider()
        .extractText(IMAGE)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(503);
      expect((error as ApiError).errorCode).toBe('OCR_FAILED');
    });

    it('names the sidecar when nothing is listening on the port', async () => {
      refuseConnection();

      const error = await new PaddleOCRProvider()
        .extractText(IMAGE)
        .catch((thrown: unknown) => thrown);

      // The most common failure on a fresh machine, and the one where a
      // generic "service unavailable" costs an operator the most time.
      expect((error as ApiError).errorCode).toBe('OCR_SERVICE_DOWN');
      expect((error as ApiError).message).toContain('not running');
    });

    it('surfaces a timeout distinctly so a retry is obviously the right move', async () => {
      const abort = new Error('The operation was aborted.');
      abort.name = 'AbortError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

      await expect(new PaddleOCRProvider().extractText(IMAGE)).rejects.toMatchObject({
        statusCode: 504,
        errorCode: 'OCR_TIMEOUT',
      });
    });

    it('treats an explicit success:false as a failure even on a 200', async () => {
      respondWith({ success: false, error: 'something went wrong' });

      await expect(new PaddleOCRProvider().extractText(IMAGE)).rejects.toMatchObject({
        errorCode: 'OCR_FAILED',
      });
    });
  });

  describe('readiness', () => {
    it('reports ready when the sidecar says its weights are loaded', async () => {
      respondWith({ ready: true, engineVersion: 'en_PP-OCRv5_mobile_rec/paddleocr-3.7.0' });

      await expect(new PaddleOCRProvider().isReady()).resolves.toBe(true);
    });

    it('reports not ready rather than throwing when the sidecar is down', async () => {
      refuseConnection();

      await expect(new PaddleOCRProvider().isReady()).resolves.toBe(false);
    });
  });
});
