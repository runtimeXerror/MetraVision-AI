import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { EMBLEM_IMAGE, LETTERHEAD_IMAGE } from '../../constants/brandAssets';

/**
 * Bundled artwork, as data URIs for the print document.
 *
 * A printed letterhead cannot reference a bundled image by path: on iOS the
 * print `WKWebView` refuses local `file://` assets outright, and on Android the
 * asset may not be unpacked where the WebView can reach it. Inlining the bytes
 * as a `data:` URI sidesteps both, and costs nothing at print time because the
 * result is cached for the life of the process.
 *
 * The document builders are synchronous — they are called from render paths —
 * so the bytes are primed once before an export and read back synchronously.
 */

type Cache = { letterhead?: string | null; emblem?: string | null };

const cache: Cache = {};

async function toDataUri(module: number | null): Promise<string | null> {
  if (module === null) return null;

  try {
    const asset = Asset.fromModule(module);
    await asset.downloadAsync();

    const uri = asset.localUri ?? asset.uri;
    if (!uri) return null;

    const base64 = await new File(uri).base64();
    const type = uri.toLowerCase().endsWith('.jpg') || uri.toLowerCase().endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/png';

    return `data:${type};base64,${base64}`;
  } catch {
    // Missing or unreadable artwork falls back to the drawn vector. A letterhead
    // that renders slightly differently is recoverable; an export that fails
    // because of a logo is not.
    return null;
  }
}

/**
 * Loads the artwork if it has not been loaded yet.
 *
 * Call before rendering a document. Safe to call on every export — after the
 * first, it resolves immediately from the cache.
 */
export async function primeBrandImages(): Promise<void> {
  if (cache.letterhead === undefined) cache.letterhead = await toDataUri(LETTERHEAD_IMAGE);
  if (cache.emblem === undefined) cache.emblem = await toDataUri(EMBLEM_IMAGE);
}

/** The masthead lockup, or `null` when no official artwork is installed. */
export function letterheadDataUri(): string | null {
  return cache.letterhead ?? null;
}

/** The emblem alone, or `null` when no official artwork is installed. */
export function emblemDataUri(): string | null {
  return cache.emblem ?? null;
}
