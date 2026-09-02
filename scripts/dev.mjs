#!/usr/bin/env node
/**
 * ── ONE COMMAND, BOTH PROCESSES ─────────────────────────────────────────────
 *
 *     npm run dev
 *
 * Starts MongoDB, the PaddleOCR sidecar and the API together, waits for each to
 * be ready before starting the next, and shuts all three down on Ctrl-C.
 *
 * ── Why the database is started here ───────────────────────────────────────
 *
 * The API can start its own in-process MongoDB when `MONGODB_URI` is unset, and
 * that is the right default for someone cloning the repository to look at it.
 * It is the wrong thing to develop against, because `mongodb-memory-server`
 * kills its mongod when the node process exits — and `tsx watch` exits the node
 * process on every file change. The outgoing and incoming servers then race for
 * the same data directory, and the observed result was that editing any file
 * left the API answering INTERNAL_ERROR to every request until it was restarted
 * by hand.
 *
 * One mongod that outlives the API removes the whole class of problem: a reload
 * reconnects to a database that never went away, and the demo accounts keep
 * their ids, so a session already open in a browser survives too.
 *
 * Written by hand rather than with `concurrently` because the only hard part
 * is finding the right Python, and that is a dependency's worth of code by
 * itself: the interpreter lives at `.venv/Scripts/python.exe` on Windows and
 * `.venv/bin/python` everywhere else, and a wrong guess produces "command not
 * found" from a tool that cannot say which command it meant.
 *
 * The sidecar is started first and its readiness is polled, so the API is not
 * accepting scans while the model is still loading — an inspector's first scan
 * of the morning should not be the request that pays for the warm-up.
 *
 * Neither process is required to be the other's child in production. This is a
 * development convenience; deployment runs them as two services, and
 * `ocr-service/README.md` documents the sidecar on its own.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from 'node:child_process';

import { backendDir, isWindows, ocrDir, pythonPath, SETUP_HINT } from './python.mjs';

const OCR_PORT = process.env.OCR_PORT ?? '8001';
const OCR_HEALTH = `http://localhost:${OCR_PORT}/health`;

// Matches `backend/scripts/mongo.mjs`, which owns the data directory.
const MONGO_PORT = 27017;
const MONGO_URI = `mongodb://127.0.0.1:${MONGO_PORT}`;

const children = [];
let shuttingDown = false;

function run(name, command, args, cwd, colour, options = {}) {
  const child = spawn(command, args, { cwd, ...options });
  children.push(child);

  const tag = `\x1b[${colour}m[${name}]\x1b[0m`;
  const relay = (stream) => (chunk) => {
    for (const rawLine of chunk.toString().split(/\r?\n/)) {
      if (rawLine.trim() === '') continue;
      // mongod still emits structured startup lines under `--quiet`: one JSON
      // document per line, which buries everything the API and the OCR service
      // say. They are dropped here; anything mongod writes in plain text —
      // including the line announcing the port — still comes through.
      if (name === 'db' && rawLine.startsWith('{"t":{"$date"')) continue;
      stream.write(`${tag} ${rawLine}\n`);
    }
  };

  child.stdout.on('data', relay(process.stdout));
  child.stderr.on('data', relay(process.stderr));

  child.on('exit', (code) => {
    if (shuttingDown) return;
    // One half of a two-process system is not a working system. Going down
    // together is clearer than leaving an API up that cannot read an image.
    console.error(`\n${tag} exited with code ${code}. Stopping everything.\n`);
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }

  // SIGTERM is not honoured by every Windows process; the exit is forced
  // shortly after so `npm run dev` always returns the terminal.
  setTimeout(() => process.exit(code), 800);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/** Resolves true once something is listening on the port, false on timeout. */
async function waitForPort(port, timeoutMs) {
  const { createConnection } = await import('node:net');
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const settle = (value) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(500);
      socket.once('connect', () => settle(true));
      socket.once('timeout', () => settle(false));
      socket.once('error', () => settle(false));
    });

    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

async function waitForOcr(timeoutMs = 180_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(OCR_HEALTH, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = await response.json();
        if (body.ready === true) return body;
      }
    } catch {
      // Not up yet. The first ever start also downloads the weights, which is
      // why the timeout is minutes rather than seconds.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

async function main() {
  const python = pythonPath();

  if (!python) {
    console.error(SETUP_HINT);
    process.exit(1);
  }

  console.log('[36mStarting MongoDB…[0m');
  run('db', isWindows ? 'npm.cmd' : 'npm', ['run', 'db'], backendDir, '34', { shell: isWindows });

  if (!(await waitForPort(MONGO_PORT, 60_000))) {
    console.error(`
MongoDB did not start on port ${MONGO_PORT}. Stopping.
`);
    shutdown(1);
    return;
  }
  console.log(`[32mMongoDB ready[0m — ${MONGO_URI}
`);

  console.log('\x1b[36mStarting OCR service…\x1b[0m (first run downloads model weights)');
  run('ocr', python, ['-m', 'uvicorn', 'app:app', '--port', OCR_PORT], ocrDir, '35');

  const health = await waitForOcr();

  if (!health) {
    console.error('\nThe OCR service did not become ready. Stopping.\n');
    shutdown(1);
    return;
  }

  console.log(`\x1b[32mOCR ready\x1b[0m — ${health.engineVersion}\n`);
  /**
   * `shell: true` on Windows, and only there.
   *
   * Node 20.12 stopped allowing `.cmd` files to be spawned directly — it
   * raises `EINVAL` rather than running them — and `npm` on Windows *is* a
   * `.cmd` shim. A shell is the supported way to invoke it. On POSIX `npm` is
   * a real executable and no shell is wanted, because a shell there would put
   * an extra process between this script and the signal it sends on Ctrl-C.
   */
  run('api', isWindows ? 'npm.cmd' : 'npm', ['run', 'dev'], backendDir, '33', {
    shell: isWindows,
    // Handed the long-lived database explicitly, so the API never falls back to
    // starting one of its own inside the watch process.
    env: { ...process.env, MONGODB_URI: MONGO_URI },
  });
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
