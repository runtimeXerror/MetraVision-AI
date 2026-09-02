/// <reference types="vite/client" />

/**
 * Typed environment.
 *
 * Only `VITE_`-prefixed variables reach the browser bundle, which is the
 * mechanism that keeps a database URL or a JWT secret from being compiled into
 * a public asset by accident.
 */
interface ImportMetaEnv {
  /** Backend base URL including `/api`. Empty in development — the dev server proxies. */
  readonly VITE_API_URL?: string;
  /** Where the dev-server proxy forwards `/api` and `/uploads`. */
  readonly VITE_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
