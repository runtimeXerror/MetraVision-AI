#!/usr/bin/env node
/** Runs only the OCR sidecar, for debugging it on its own. */

import { spawn } from 'node:child_process';

import { ocrDir, pythonPath, SETUP_HINT } from './python.mjs';

const python = pythonPath();

if (!python) {
  console.error(SETUP_HINT);
  process.exit(1);
}

const port = process.env.OCR_PORT ?? '8001';
const child = spawn(python, ['-m', 'uvicorn', 'app:app', '--port', port], {
  cwd: ocrDir,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
