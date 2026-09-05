import { Directory, File, Paths } from 'expo-file-system';

/**
 * ── THE REGISTER, ON THE DEVICE ─────────────────────────────────────────────
 *
 * Every read the app has ever completed, written to disk so it can be read
 * again with no connection at all.
 *
 * The case this exists for is the ordinary working day. An inspector is in a
 * godown with one bar of signal, or none; they need to show a dealer the report
 * filed against last month's consignment, check what was found on the previous
 * visit, or read their own week's figures. None of that is new work and none of
 * it needs a server — it is a record that was already fetched once. Before
 * this, all of it lived in memory and the app came up empty: a spinner, then
 * "Could not reach the server", on data the phone had displayed an hour
 * earlier.
 *
 * Three rules govern what is kept here, and all three are about not lying to
 * the officer holding the phone.
 *
 * **A cached read is always labelled as one.** Nothing in this file hides the
 * age of what it returns; `savedAt` comes back with every hit, and the screens
 * show it. An enforcement record shown without its date is a record whose
 * currency the officer cannot judge, and they may be about to quote it.
 *
 * **Writes are never cached.** Creating an inspection, uploading a photograph,
 * filing a finding — none of it is queued here to be replayed later. A record
 * that filed itself from a phone hours after the officer left the premises is
 * an enforcement action nobody witnessed. New inspections need the network, and
 * say so.
 *
 * **The cache belongs to one officer.** Handsets are shared between officers on
 * a shift; every entry carries the inspector id that fetched it and is refused
 * to anyone else, the same check `draftService` makes for the same reason.
 *
 * Written to the *document* directory rather than the cache directory: the
 * cache is exactly what the OS reclaims when a device is short of space, which
 * is disproportionately the moment an officer is out in the field with no
 * signal and needs it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Bumped when any cached shape changes, so an entry written by an older build
 * is dropped rather than misread. Cheaper than migrating: the worst case is one
 * online refresh.
 */
const CACHE_VERSION = 1;

const CACHE_DIR = 'offline-cache';
const IMAGE_DIR = 'images';

/**
 * How much of the register is kept for offline browsing.
 *
 * Three hundred inspection summaries — roughly 120 KB — which is more than a
 * field officer files in a year and small enough that the whole pool is read
 * and filtered in a single frame. The cap matters because this pool is what
 * History searches when there is no connection: an unbounded one would grow
 * until the first offline search took a visible pause.
 */
export const RECORD_POOL_LIMIT = 300;

/**
 * A ceiling on cached label photographs.
 *
 * Sixty megabytes. Photographs are the bulk of what an inspection weighs — a
 * report with its label images is the document an officer actually shows a
 * dealer, so they are worth keeping — but a phone that has filled its storage
 * with them has been made worse, not better. Least-recently-used entries go
 * first when the ceiling is crossed.
 */
const IMAGE_CACHE_LIMIT_BYTES = 60 * 1024 * 1024;

interface CacheEnvelope<T> {
  version: number;
  /** The inspector who fetched this. See the third rule above. */
  owner: string;
  savedAt: string;
  data: T;
}

/** A cache hit: the value, and when it was written. */
export interface CachedValue<T> {
  data: T;
  savedAt: string;
}

/** The outcome of a read-through: where the value came from, and how old it is. */
export interface ReadThroughResult<T> {
  data: T;
  /** True when the network could not be reached and this came off the disk. */
  fromCache: boolean;
  /** When the cached copy was written. Null for a fresh network read. */
  savedAt: string | null;
}

/* ── Paths ────────────────────────────────────────────────────────────────── */

function cacheDirectory(): Directory {
  const directory = new Directory(Paths.document, CACHE_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function imageDirectory(): Directory {
  const directory = new Directory(cacheDirectory(), IMAGE_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * A stable file name for an arbitrary cache key.
 *
 * FNV-1a rather than a real digest: React Native has no `crypto.subtle`, and a
 * cryptographic hash is not what this needs. The only requirement is that two
 * different keys collide rarely enough not to matter, and that the same key
 * always produces the same name across launches — which a content-derived hash
 * gives and a counter would not.
 *
 * A readable prefix is kept so the directory can be inspected during
 * development; `list:status=violation…` is diagnosable where `1f3a9c2b` is not.
 */
function fileNameFor(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const prefix = key.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40);
  return `${prefix}.${hash.toString(36)}.json`;
}

/* ── Reading and writing ──────────────────────────────────────────────────── */

/**
 * Reads one entry back.
 *
 * Returns `null` for every reason an entry might not be usable — nothing
 * cached, written by an older build, or belonging to a different officer — and
 * never throws. A cache that cannot be trusted is the same as no cache, and a
 * corrupt entry must not be able to stop a screen rendering.
 */
export async function readCached<T>(key: string, owner: string): Promise<CachedValue<T> | null> {
  try {
    const file = new File(cacheDirectory(), fileNameFor(key));
    if (!file.exists) return null;

    const envelope = JSON.parse(await file.text()) as CacheEnvelope<T>;

    if (envelope?.version !== CACHE_VERSION) return null;
    if (envelope.owner !== owner) return null;
    if (envelope.data === undefined) return null;

    return { data: envelope.data, savedAt: envelope.savedAt };
  } catch {
    return null;
  }
}

/**
 * Writes one entry.
 *
 * Failures are swallowed deliberately, exactly as `draftService` swallows
 * them. This runs behind every successful list load; a full disk must not
 * surface as an error over data that arrived perfectly well. The cost of a
 * failed write is the next offline read missing, which is where the officer
 * was before this existed.
 */
export function writeCached<T>(key: string, owner: string, data: T): void {
  try {
    const envelope: CacheEnvelope<T> = {
      version: CACHE_VERSION,
      owner,
      savedAt: new Date().toISOString(),
      data,
    };

    new File(cacheDirectory(), fileNameFor(key)).write(JSON.stringify(envelope));
  } catch {
    // Intentionally silent — see above.
  }
}

/**
 * Network first, disk second.
 *
 * The order matters and is not the usual cache-first: an inspector opening a
 * record wants what the server holds now, because a supervisor may have
 * amended it since. The cache is the fallback for the one failure it can
 * honestly answer — the network being unreachable.
 *
 * Note what is *not* caught here. A 404, a 403, an expired session, a rejected
 * request: all of those are answers from a server that was reached, and
 * covering them with a stale copy would show an officer a record they no longer
 * have access to. Only `network` and `timeout` — nothing came back at all —
 * fall through to the disk.
 *
 * Callers that want the cached copy on screen *before* the request finishes —
 * which is what makes the app usable on a bar of signal rather than merely
 * usable with none — read the cache themselves first with `readCached` and then
 * call this. The stores do exactly that.
 */
export async function readThrough<T>(options: {
  key: string;
  owner: string;
  fetch: () => Promise<T>;
}): Promise<ReadThroughResult<T>> {
  const { key, owner, fetch } = options;

  try {
    const data = await fetch();
    writeCached(key, owner, data);
    return { data, fromCache: false, savedAt: null };
  } catch (error) {
    if (!isOfflineFailure(error)) throw error;

    const cached = await readCached<T>(key, owner);
    if (!cached) throw error;

    return { data: cached.data, fromCache: true, savedAt: cached.savedAt };
  }
}

/**
 * Whether a failure means "the server was never reached".
 *
 * Kept as a duck-typed check rather than importing `ApiError`, so this module
 * stays free of the HTTP layer and can be unit-tested without it.
 */
export function isOfflineFailure(error: unknown): boolean {
  const kind = (error as { kind?: string } | null)?.kind;
  return kind === 'network' || kind === 'timeout';
}

/* ── Housekeeping ─────────────────────────────────────────────────────────── */

/**
 * Empties the cache.
 *
 * Called on sign-out. An officer handing the phone to a colleague must not
 * leave their register on it — the owner check already refuses to serve it, but
 * refusing to read a file is not the same as not having written it.
 */
export function clearOfflineCache(): void {
  try {
    const directory = new Directory(Paths.document, CACHE_DIR);
    if (directory.exists) directory.delete();
  } catch {
    // A cache that will not delete is still owner-checked on every read.
  }
}

/** Total bytes on disk, so the profile screen can state what is being held. */
export function offlineCacheSize(): number {
  try {
    return new Directory(Paths.document, CACHE_DIR).size ?? 0;
  } catch {
    return 0;
  }
}

/* ── Photographs ──────────────────────────────────────────────────────────── */

/**
 * Label photographs, cached beside the records that reference them.
 *
 * A report is a document an officer holds up to a dealer, and a report whose
 * label images are four grey boxes is not that document — the photograph *is*
 * the evidence for the finding beside it. So images are cached too, but only
 * for records that have actually been opened: downloading every photograph of
 * every inspection would put hundreds of megabytes on the phone to serve a
 * screen nobody may visit.
 */

function imageFileName(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  // The extension is kept because the OS image loader on Android uses it to
  // pick a decoder; a cached JPEG saved without one renders as nothing.
  const extension = url.split('?')[0]?.split('.').pop()?.toLowerCase();
  const suffix = extension && /^(jpe?g|png|webp|heic)$/.test(extension) ? extension : 'jpg';

  return `${hash.toString(36)}.${suffix}`;
}

/** The local URI for a photograph already on disk, or undefined if it is not. */
export function cachedImageUri(url: string): string | undefined {
  if (!url || !/^https?:/.test(url)) return undefined;

  try {
    const file = new File(imageDirectory(), imageFileName(url));
    // A zero-byte file is an interrupted download, not a cached image; treating
    // it as a hit would render an empty frame that no refresh ever repairs.
    return file.exists && file.size > 0 ? file.uri : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Downloads one photograph if it is not already held.
 *
 * Resolves to the local URI, or `undefined` when it could not be fetched —
 * offline, most often, which is not an error worth surfacing: the caller falls
 * back to the remote URL and the OS shows its own placeholder.
 */
export async function ensureImageCached(url: string): Promise<string | undefined> {
  const existing = cachedImageUri(url);
  if (existing) return existing;

  if (!url || !/^https?:/.test(url)) return undefined;

  try {
    const file = await File.downloadFileAsync(url, new File(imageDirectory(), imageFileName(url)), {
      idempotent: true,
    });

    // A server that answered with an error page still produces a file; size is
    // the cheapest way to tell that apart from a photograph.
    if (!file.exists || file.size === 0) {
      if (file.exists) file.delete();
      return undefined;
    }

    void pruneImageCache();
    return file.uri;
  } catch {
    return undefined;
  }
}

/**
 * Drops the oldest photographs once the ceiling is crossed.
 *
 * Oldest by modification time, which for a downloaded file is when it was
 * cached — so what goes is what has been sitting unread the longest. Called
 * after a download rather than on a timer: the cache can only grow at the
 * moment something is added to it.
 */
export async function pruneImageCache(limitBytes = IMAGE_CACHE_LIMIT_BYTES): Promise<void> {
  try {
    const directory = imageDirectory();

    const files = directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => ({
        file,
        size: file.size ?? 0,
        modifiedAt: file.modificationTime ?? 0,
      }));

    let total = files.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= limitBytes) return;

    files.sort((a, b) => a.modifiedAt - b.modifiedAt);

    for (const entry of files) {
      if (total <= limitBytes) break;
      try {
        entry.file.delete();
        total -= entry.size;
      } catch {
        // Skip the ones that will not delete; the next prune tries again.
      }
    }
  } catch {
    // Pruning is maintenance. Failing at it must never fail the download that
    // triggered it.
  }
}
