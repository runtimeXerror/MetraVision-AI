import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Environment-based configuration.
 *
 * No screen, store or service may hardcode a backend URL — they all read from
 * here. Phase 2 changes this file and nothing else.
 */

/**
 * Resolving the API base URL is the one piece of mobile configuration that
 * reliably breaks a demo, so it is handled explicitly.
 *
 * `localhost` on a phone means *the phone*, not the developer's laptop. When no
 * explicit URL is supplied we derive the host from the Expo dev-server address
 * the app was loaded from, which is correct for a physical device on the same
 * Wi-Fi and for the Android emulator alike.
 */
function inferHostFromExpo(): string | undefined {
  // e.g. "192.168.1.7:8081" whenever the app runs through Expo Go / a dev client.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;

  return hostUri?.split(':')[0];
}

function resolveApiUrl(): string {
  // 1. An explicit env var always wins.
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  // 2. Derive the LAN address of the machine that will run the backend.
  const host = inferHostFromExpo();
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:4000/api`;
  }

  // 3. Emulator loopbacks.
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000/api';
  return 'http://localhost:4000/api';
}

export const API_BASE_URL = resolveApiUrl();

/** Origin without the `/api` suffix — used to build absolute image URLs. */
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

/**
 * Phase 2 talks to the real backend. The flag is kept so a demo can be run
 * against a deliberately offline build, but it now defaults to *off* — the
 * mock service layer was removed when the API landed.
 */
export const USE_MOCK_SERVICES = process.env.EXPO_PUBLIC_USE_MOCK === 'true';

/** Request timeout for the Phase 2 HTTP client, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Resolves a possibly-relative asset path against the API origin. */
export function assetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|data:|file:|content:|asset:)/.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Uploads are slower than ordinary calls — a multi-megabyte photograph over a
 * field connection needs a longer leash than a JSON GET.
 */
export const UPLOAD_TIMEOUT_MS = 60_000;
