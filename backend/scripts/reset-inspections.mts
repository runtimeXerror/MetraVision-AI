import { rm, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import mongoose from 'mongoose';

import { env } from '../src/config/env';
import { Counter } from '../src/models/Counter';
import { Inspection } from '../src/models/Inspection';

/**
 * ── A CLEAN REGISTER, WITHOUT A CLEAN DATABASE ──────────────────────────────
 *
 *     npm run reset:inspections
 *
 * Deletes every inspection and every photograph uploaded with one, and leaves
 * everything else standing.
 *
 * ── Why not just delete the database ───────────────────────────────────────
 *
 * Two reasons, and both bite.
 *
 * The accounts go with it. Sign-in is the first thing anyone does, and a
 * database with no users cannot be signed into — so wiping it means either
 * re-seeding or being locked out of the app you cleared in order to test.
 *
 * And the seeder would put the demo inspections back. `AUTO_SEED` runs on boot
 * `onlyIfEmpty`, and "empty" is measured by counting users: with no users it
 * seeds the demo accounts *and* a set of sample inspections. Anyone clearing
 * the register in order to scan real packages would find it repopulated with
 * fixtures on the next start — which is the opposite of the intent.
 *
 * Keeping the users is therefore not a convenience, it is what stops the seeder
 * firing. The register comes back empty and stays empty.
 *
 * ── The reference counter ──────────────────────────────────────────────────
 *
 * Reset too, so the first inspection after this is `INS-<year>-00001` rather
 * than continuing from wherever the deleted records had reached. That is the
 * right call here and would be the wrong one in production, where a reference
 * that has been quoted must never be minted twice. This script is for a test
 * machine and says so before it does anything.
 * ────────────────────────────────────────────────────────────────────────────
 */

const uri = env.MONGODB_URI?.trim();

if (!uri) {
  console.error(
    'MONGODB_URI is not set, so there is no database to clear.\n' +
      'This script deliberately refuses to start an in-process one: clearing a\n' +
      'database that only exists for the length of this process would do nothing.',
  );
  process.exit(1);
}

if (env.isProduction) {
  console.error('Refusing to run against a production configuration.');
  process.exit(1);
}

await mongoose.connect(uri, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 10_000 });

const before = await Inspection.countDocuments();
console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
console.log(`Inspections on record: ${before}`);

const { deletedCount } = await Inspection.deleteMany({});

// Only the inspection-reference sequences. Any other counter belongs to
// something this script is not clearing.
const counters = await Counter.deleteMany({ _id: /^inspection:/ });

/**
 * The photographs.
 *
 * `uploads/inspections` only. `uploads/seed` holds the fixture images the demo
 * records point at, and those are part of the seed rather than of anyone's
 * fieldwork — deleting them would leave a future `npm run seed` with broken
 * evidence and nothing to say why.
 */
const uploadsRoot = join(process.cwd(), env.UPLOAD_DIR);
const inspectionUploads = join(uploadsRoot, 'inspections');

let removedFiles = 0;
try {
  removedFiles = (await readdir(inspectionUploads)).length;
  await rm(inspectionUploads, { recursive: true, force: true });
  await mkdir(inspectionUploads, { recursive: true });
} catch {
  // Nothing uploaded yet, which is not a failure.
}

console.log('');
console.log(`  inspections deleted   ${deletedCount}`);
console.log(`  counters reset        ${counters.deletedCount}`);
console.log(`  upload folders removed ${removedFiles}`);
console.log('');
console.log('Users, rules and the legal corpus are untouched — sign in as before.');
console.log('The next inspection will be numbered 00001.');

await mongoose.disconnect();
