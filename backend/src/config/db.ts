import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import mongoose from 'mongoose';

import { env } from './env';
import { logger } from './logger';

const run = promisify(execFile);

/**
 * Where the development fallback keeps its data.
 *
 * Fixed rather than the random temp directory `mongodb-memory-server` picks by
 * default, and that matters more than it sounds. `tsx watch` restarts the
 * server on every file change, and each restart used to start a fresh mongod in
 * a fresh directory — about 300 MB of preallocated WiredTiger journal each. The
 * old one is only stopped by the SIGTERM handler below, which does not run when
 * the process is force-killed, so an afternoon of editing left a queue of
 * orphaned mongod processes each holding 300 MB. Once the disk filled, the next
 * mongod could not allocate its journal and aborted on startup — which is what
 * "the backend keeps failing" actually was.
 *
 * One path means one directory however many times the server restarts, and the
 * data survives a restart instead of being reseeded with fresh ids.
 */
const DEV_DB_PATH = join(tmpdir(), 'sih26034-dev-mongo');

/**
 * MongoDB connection.
 *
 * Resolution order:
 *   1. `MONGODB_URI` — a real server (local mongod, Docker, or Atlas).
 *   2. No URI → start an in-process MongoDB via `mongodb-memory-server`.
 *
 * The fallback exists because the system must be demonstrable on a laptop with
 * nothing installed. It is development-only: in production a missing URI is a
 * hard failure rather than a silently ephemeral database.
 */

let memoryServer: {
  stop: (options?: { doCleanup?: boolean; force?: boolean }) => Promise<unknown>;
} | null = null;

export async function connectDatabase(): Promise<string> {
  mongoose.set('strictQuery', true);

  let uri = env.MONGODB_URI?.trim();

  if (!uri) {
    if (env.isProduction) {
      throw new Error('MONGODB_URI is required in production.');
    }

    logger.warn('MONGODB_URI not set — starting a local MongoDB for development.');
    logger.warn(
      `Data is kept in ${DEV_DB_PATH} and survives a restart, but that directory is ` +
        'temporary. Set MONGODB_URI for a durable database.',
    );

    // Imported lazily so a production install never has to resolve this package.
    const { MongoMemoryServer } = await import('mongodb-memory-server');

    await mkdir(DEV_DB_PATH, { recursive: true });

    const server = await startDevMongo(MongoMemoryServer);
    memoryServer = server;
    uri = server.getUri();
  }

  await mongoose.connect(uri, {
    dbName: env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
  });

  logger.info(
    `MongoDB connected · ${mongoose.connection.host ?? 'in-memory'}/${mongoose.connection.name}`,
  );

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  return uri;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  if (memoryServer) {
    // `doCleanup: false` keeps the directory, which is the point of the fixed
    // path: the next start reuses this data rather than reseeding it with new
    // ids and invalidating every token already in a browser.
    await memoryServer.stop({ doCleanup: false, force: false });
    memoryServer = null;
  }
}

/**
 * Starts the development mongod on the fixed path, waiting out a predecessor.
 *
 * `tsx watch` restarts this process on every file change, and the outgoing
 * mongod does not always release its lock before the incoming one asks for it.
 * The first version of this fell back to a fresh temporary directory when that
 * happened, which was worse than the problem it solved: a watch-triggered
 * restart storm quietly wrote a new 300 MB directory per restart until the disk
 * was full.
 *
 * So there is no fallback path. Either this starts on the one directory this
 * application owns, or it fails and says why — a loud failure costs a minute,
 * a silent 300 MB costs an afternoon.
 */
async function startDevMongo(
  MongoMemoryServer: typeof import('mongodb-memory-server').MongoMemoryServer,
): Promise<InstanceType<typeof MongoMemoryServer>> {
  const instance = { dbName: env.MONGODB_DB_NAME, dbPath: DEV_DB_PATH };
  let reaped = false;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await MongoMemoryServer.create({ instance });
    } catch (error) {
      const held = String(error).includes('DBPathInUse');

      if (!held) throw error;

      // A predecessor still holds the lock. Give it a moment to exit on its own
      // before concluding it never will and killing it.
      if (attempt >= 2 && !reaped) {
        logger.warn('Database directory still locked — reaping the previous mongod.');
        reaped = await reapStaleMongod();
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw new Error(
    `Could not start MongoDB on ${DEV_DB_PATH} — a previous mongod is still holding it. ` +
      'Kill any leftover mongod process and start again, or set MONGODB_URI.',
  );
}

/**
 * Kills a mongod left holding the development data directory.
 *
 * Scoped by command line to the path above, so it can only ever terminate a
 * mongod this application started — never a MongoDB the machine runs for
 * something else.
 */
async function reapStaleMongod(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell', [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name LIKE 'mongod%'" | ` +
          `Where-Object { $_.CommandLine -like '*sih26034-dev-mongo*' } | ` +
          'Select-Object -ExpandProperty ProcessId',
      ]);

      const pids = stdout.split(/\s+/).filter(Boolean);
      for (const pid of pids) await run('taskkill', ['/PID', pid, '/F']);

      if (pids.length) logger.warn(`Reaped ${pids.length} orphaned mongod process(es).`);
      return pids.length > 0;
    }

    const { stdout } = await run('pgrep', ['-f', 'sih26034-dev-mongo']);
    const pids = stdout.split(/\s+/).filter(Boolean);
    for (const pid of pids) process.kill(Number(pid), 'SIGKILL');

    if (pids.length) logger.warn(`Reaped ${pids.length} orphaned mongod process(es).`);
    return pids.length > 0;
  } catch {
    // Nothing matched, or the lookup tool is unavailable. Either way there is
    // nothing to reap and the caller falls back.
    return false;
  }
}

/** True when the current connection is the ephemeral in-memory server. */
export function isEphemeralDatabase(): boolean {
  return memoryServer !== null;
}
