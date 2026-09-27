import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * One MongoDB for the whole run.
 *
 * Previously every test file started its own `MongoMemoryServer` from
 * `setup.ts`. Seven files meant seven mongod boots per run — and, because
 * WiredTiger preallocates its journal, roughly 300 MB of temporary data
 * directory each. `stop()` without `doCleanup` leaves those behind, so a single
 * `npm test` left about two gigabytes in the system temp directory and the next
 * run started from a fuller disk than the last. Once the disk filled, mongod
 * could not allocate its journal and aborted on startup, which surfaced as
 * every suite failing to connect and all 109 tests being skipped.
 *
 * A shared instance fixes both halves: one boot instead of seven, and one
 * directory, at a path this file chooses.
 *
 * Choosing the path is what bounds the leak. Cleanup is attempted on the way
 * out, but on Windows mongod's file handles outlive `stop()` often enough that
 * the removal fails — and a randomly named directory that fails to delete is a
 * directory that accumulates. A fixed path is cleared on the way *in* instead,
 * when nothing can still be holding it, so the worst case is one stale
 * directory rather than one per run forever.
 */

const DB_PATH = join(tmpdir(), 'metravision-test-mongo');

let server: MongoMemoryServer | undefined;

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  // Whatever the last run could not delete, this run can. An explicitly named
  // dbPath is not created for us the way a generated one is, so it has to exist
  // before mongod is pointed at it.
  await rm(DB_PATH, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await mkdir(DB_PATH, { recursive: true });

  server = await MongoMemoryServer.create({
    instance: { dbPath: DB_PATH },
  });
  provide('mongoUri', server.getUri());
}

export async function teardown(): Promise<void> {
  if (!server) return;

  await server.stop({ doCleanup: true, force: true });

  // Best effort. If Windows still holds a handle this throws EBUSY, which must
  // not fail the run — the next `setup` clears the same path before reusing it.
  await rm(DB_PATH, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
    () => undefined,
  );
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
