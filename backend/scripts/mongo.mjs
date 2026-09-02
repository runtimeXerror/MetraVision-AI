import { spawn } from 'node:child_process';
import { access, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A long-lived MongoDB for development.
 *
 * `npm run dev` can start its own database when `MONGODB_URI` is unset, and
 * that is the right default for someone cloning this repository to look at it.
 * It is the wrong thing to develop against for long: `tsx watch` restarts the
 * server on every file change, each restart boots a fresh mongod, and mongod
 * preallocates roughly 300 MB of WiredTiger journal before it will accept a
 * connection. Restarts become slow, the outgoing and incoming instances race
 * for the same data directory, and any that are force-killed leave their
 * directory behind until the disk fills.
 *
 * One mongod that outlives the server solves all of it: restarts stop touching
 * the database at all, and the data — including the demo accounts' ids, and so
 * any session already open in a browser — survives them.
 *
 * Run this in its own terminal, then `npm run dev` in another. It reuses the
 * mongod binary `mongodb-memory-server` has already downloaded, so there is
 * nothing to install.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

// Beside the repository rather than in the system temp directory: this is data
// worth keeping across reboots, and on a Windows machine the system drive is
// usually the one that is short of space.
const DATA_DIR = join(projectRoot, '.mongo-data');
const PORT = 27017;

async function findMongod() {
  const cacheDir = join(homedir(), '.cache', 'mongodb-binaries');

  try {
    const entries = await readdir(cacheDir);
    const binary = entries.find((name) => name.startsWith('mongod'));
    if (binary) return join(cacheDir, binary);
  } catch {
    // No cache yet — fall through to whatever is on PATH.
  }

  return 'mongod';
}

const mongod = await findMongod();

if (mongod !== 'mongod') {
  await access(mongod).catch(() => {
    throw new Error(`Expected a mongod binary at ${mongod}`);
  });
}

await mkdir(DATA_DIR, { recursive: true });

console.log(`mongod   ${mongod}`);
console.log(`data     ${DATA_DIR}`);
console.log(`listening on mongodb://127.0.0.1:${PORT}`);
console.log('');
// `npm run dev` at the repository root starts this script itself, so the
// message has to make sense both there and when it is run on its own.
console.log('Leave this running. The API connects to it with MONGODB_URI.');
console.log('');

// `--quiet` because this now shares a terminal with the API and the OCR
// service: mongod's default output is a JSON document per line and it drowns
// everything else. Warnings and errors still come through.
const child = spawn(mongod, ['--dbpath', DATA_DIR, '--port', String(PORT), '--quiet'], {
  stdio: 'inherit',
});

// Without this the mongod outlives Ctrl-C and holds both the port and the data
// directory — the exact orphan this script exists to stop happening.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', (code) => process.exit(code ?? 0));
