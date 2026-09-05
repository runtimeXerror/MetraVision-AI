import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies the development database to a hosted MongoDB.
 *
 * The local mongod is the right thing to develop against and the wrong thing to
 * depend on: it lives on one laptop, it is not backed up, and a demo runs from
 * whichever machine happens to be in the room. This lifts the whole database —
 * inspectors, inspections, the rule catalogue and the counters that mint
 * reference ids — onto an Atlas cluster, after which `MONGODB_URI` points there
 * and nothing else in the application changes.
 *
 * `mongodump`/`mongorestore` would be the usual tools. They ship separately
 * from the server as the MongoDB Database Tools and are not installed here, and
 * this database is small enough — a few hundred documents — that the driver
 * already in `node_modules` copies it in a second without asking anyone to
 * install anything.
 *
 * Reads both endpoints from `backend/.env`, which is gitignored:
 *
 *   MONGODB_URI       the source, the local mongod
 *   MONGODB_URI_ATLAS the destination, from the Atlas connection dialog
 *
 * Then:  node scripts/migrate-to-atlas.mjs [--drop] [--dry-run]
 *
 * Safe to run more than once. Documents are matched on `_id` and replaced, so a
 * second run reconciles rather than duplicating — which matters because the
 * first run is usually a rehearsal and the real one happens after another day
 * of inspections. `--drop` empties each destination collection first, for when
 * the target has diverged and you want an exact copy rather than a merge.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

loadEnv({ path: join(projectRoot, '.env') });

const args = new Set(process.argv.slice(2));
const DROP = args.has('--drop');
const DRY_RUN = args.has('--dry-run');

const SOURCE_URI = process.env.MONGODB_URI?.trim();
const TARGET_URI = process.env.MONGODB_URI_ATLAS?.trim();
const DB_NAME = process.env.MONGODB_DB_NAME?.trim() || 'sih26034';

/**
 * Collections that are rebuilt rather than moved.
 *
 * Refresh tokens are sessions, not records: they are bound to the old
 * deployment, every one of them expires on its own, and copying them across
 * only carries a credential into a new database for no benefit. Everyone signs
 * in again after the move, which is the correct outcome anyway.
 */
const SKIP = new Set(['refreshtokens']);

/** Never print a connection string — it carries the password. */
function describe(uri) {
  try {
    const { protocol, hostname } = new URL(uri);
    return `${protocol}//${hostname}`;
  } catch {
    return '<unparseable URI>';
  }
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

if (!SOURCE_URI) {
  fail('MONGODB_URI is not set in backend/.env — nothing to copy from.');
}

if (!TARGET_URI) {
  fail(
    'MONGODB_URI_ATLAS is not set in backend/.env.\n' +
      "    Add the Atlas connection string to that file, e.g.\n" +
      '    MONGODB_URI_ATLAS=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority',
  );
}

if (SOURCE_URI === TARGET_URI) {
  fail('MONGODB_URI and MONGODB_URI_ATLAS are the same — that would copy a database onto itself.');
}

const source = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 10_000 });
const target = new MongoClient(TARGET_URI, { serverSelectionTimeoutMS: 30_000 });

try {
  console.log(`\n  Database   ${DB_NAME}`);
  console.log(`  From       ${describe(SOURCE_URI)}`);
  console.log(`  To         ${describe(TARGET_URI)}`);
  if (DRY_RUN) console.log('  Mode       dry run — nothing will be written');
  if (DROP && !DRY_RUN) console.log('  Mode       --drop — destination collections are emptied first');
  console.log();

  await source.connect();
  await target.connect();

  const from = source.db(DB_NAME);
  const to = target.db(DB_NAME);

  const collections = (await from.listCollections().toArray())
    .filter((c) => c.type !== 'view')
    .map((c) => c.name)
    .sort();

  if (collections.length === 0) fail(`No collections in ${DB_NAME} on the source.`);

  let copied = 0;
  let skipped = 0;

  for (const name of collections) {
    const docs = await from.collection(name).find({}).toArray();

    if (SKIP.has(name)) {
      console.log(`  ─ ${name}: ${docs.length} documents skipped (sessions do not travel)`);
      skipped += docs.length;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  · ${name}: ${docs.length} documents would be copied`);
      copied += docs.length;
      continue;
    }

    if (DROP) {
      // `deleteMany` rather than `drop`, so the collection's indexes survive and
      // a re-run does not have to rebuild them.
      await to.collection(name).deleteMany({});
    }

    if (docs.length > 0) {
      // Replace on `_id`. Every reference in this database is by ObjectId —
      // an inspection points at its inspector, a finding at its rule — so the
      // ids have to arrive unchanged or the records land unlinked.
      await to.collection(name).bulkWrite(
        docs.map((doc) => ({
          replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
        })),
        { ordered: false },
      );
    } else {
      // An empty collection still has to exist: the application queries it on
      // startup, and Mongoose only creates it lazily on first write.
      await to.createCollection(name).catch(() => {});
    }

    await copyIndexes(from, to, name);

    console.log(`  ✓ ${name}: ${docs.length} documents`);
    copied += docs.length;
  }

  console.log();

  if (DRY_RUN) {
    console.log(`  Dry run complete — ${copied} documents ready to copy, ${skipped} skipped.\n`);
  } else {
    await verify(from, to, collections);
    console.log(`  Copied ${copied} documents across ${collections.length - SKIP.size} collections.`);
    console.log('\n  Next: point MONGODB_URI at the Atlas cluster and restart the backend.\n');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await source.close().catch(() => {});
  await target.close().catch(() => {});
}

/**
 * Recreates the source's indexes on the destination.
 *
 * They are not decoration: the unique index on an inspector's email is what
 * stops a second account being created with it, and losing it in the move would
 * turn a constraint the application relies on into an unenforced convention.
 */
async function copyIndexes(from, to, name) {
  const indexes = await from.collection(name).indexes();

  for (const index of indexes) {
    if (index.name === '_id_') continue; // Created with the collection.

    const { key, name: indexName, v, ns, background, ...options } = index;
    void v;
    void ns;
    void background;

    try {
      await to.collection(name).createIndex(key, { name: indexName, ...options });
    } catch (error) {
      // An index that already exists with the same shape is not a problem; one
      // that exists with a different shape is, and has to be visible rather
      // than swallowed into a silently weaker schema.
      const message = error instanceof Error ? error.message : String(error);
      if (!/already exists|IndexOptionsConflict|IndexKeySpecsConflict/i.test(message)) throw error;
      console.log(`      ! ${name}.${indexName}: ${message.split('\n')[0]}`);
    }
  }
}

/** Counts both sides, so the run ends on evidence rather than on hope. */
async function verify(from, to, collections) {
  let mismatched = 0;

  for (const name of collections) {
    if (SKIP.has(name)) continue;

    const before = await from.collection(name).countDocuments();
    const after = await to.collection(name).countDocuments();

    if (before !== after) {
      console.error(`  ✗ ${name}: ${before} on the source, ${after} on the destination`);
      mismatched += 1;
    }
  }

  if (mismatched > 0) fail(`${mismatched} collection(s) did not match after the copy.`);

  console.log('  ✓ Verified — every collection matches on both sides.');
}
