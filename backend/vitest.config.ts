import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    /**
     * The suite runs against a fixed environment, not the developer's `.env`.
     *
     * `dotenv` does not override variables already present in `process.env`, so
     * setting them here wins. Without it the tests inherited whatever OCR
     * provider the machine happened to be configured for: setting
     * `OCR_PROVIDER=gemini` to try a real key turned twenty passing tests red,
     * because pinning a mock fixture is refused when a live provider is
     * configured — correctly, but the suite is not the place to discover it.
     *
     * A test run must never reach a paid API or depend on a credential, and it
     * must give the same answer on a laptop and in CI.
     */
    env: {
      NODE_ENV: 'test',
      OCR_PROVIDER: 'mock',
      OCR_API_KEY: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      MOCK_OCR_DELAY_MS: '0',
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
