import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    /**
     * The suite runs against a fixed environment, not the developer's `.env`.
     *
     * `dotenv` does not override variables already present in `process.env`, so
     * setting them here wins. Without it the tests inherited whatever OCR
     * provider the machine happened to be configured for: switching
     * `OCR_PROVIDER` to a live provider turned twenty passing tests red,
     * because pinning a mock fixture is refused when a live provider is
     * configured — correctly, but the suite is not the place to discover it.
     *
     * A test run must never reach a paid API, depend on a credential, or need
     * the PaddleOCR sidecar to be running, and it must give the same answer on
     * a laptop and in CI. `PaddleOCRProvider` is covered in
     * `tests/ocr.paddle.test.ts` against a stubbed `fetch`; the engine itself
     * is covered by the Python suite in `ocr-service/tests/`.
     */
    env: {
      NODE_ENV: 'test',
      OCR_PROVIDER: 'mock',
      OCR_API_KEY: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      // Unroutable on purpose: if a test ever does construct the Paddle
      // provider for real, it must fail fast rather than quietly reach a
      // sidecar the developer happens to have running.
      OCR_SERVICE_URL: 'http://127.0.0.1:9',
      MOCK_OCR_DELAY_MS: '0',
      /*
       * The same rule as the OCR provider above, and it was missed when the
       * model stage was added.
       *
       * `LLM_PROVIDER` was read from the developer's `.env`, so every run of
       * the suite made real calls to Google — six of them from the corpus
       * tests alone, before the pipeline tests. The free tier for
       * `gemini-3.7-flash` is twenty requests a *day*, so a morning's work on
       * the extractor exhausted the quota, and every scan the inspector made
       * afterwards ran with the model silently skipped.
       *
       * A test run must never reach a paid API. `GeminiLLMProvider` has its
       * own tests against a stubbed `fetch`; the key is blanked as well as the
       * provider, so a provider constructed by mistake still cannot call out.
       */
      LLM_PROVIDER: 'none',
      GEMINI_API_KEY: '',
    },
    globals: false,
    // One MongoDB for the whole run, started here rather than per file — see
    // tests/globalSetup.ts for why that mattered.
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],
    // The in-memory MongoDB download and boot dominates a cold first run.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Suites share a mongoose connection, so they must not run concurrently.
    fileParallelism: false,
  },
});
