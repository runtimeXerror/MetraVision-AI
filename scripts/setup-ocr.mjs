#!/usr/bin/env node
/**
 * Creates the OCR service's virtual environment and installs its dependencies.
 *
 * Run once per machine. It does *not* download the model weights — PaddleOCR
 * fetches those on the first scan and caches them outside the repository, so
 * the first `npm run dev` after this is the slow one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { isWindows, ocrDir, pythonPath } from './python.mjs';

function run(command, args, cwd = ocrDir) {
  console.log(`\x1b[36m$ ${command} ${args.join(' ')}\x1b[0m`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });

  if (result.error) {
    console.error(`\nCould not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const venv = path.join(ocrDir, '.venv');

if (!existsSync(venv)) {
  // `python3` first on POSIX, where `python` is often absent or Python 2.
  const system = isWindows ? 'python' : 'python3';
  run(system, ['-m', 'venv', '.venv']);
} else {
  console.log('Virtual environment already exists; installing dependencies into it.');
}

const python = pythonPath();

if (!python) {
  console.error('\nThe virtual environment was created but holds no interpreter.');
  process.exit(1);
}

run(python, ['-m', 'pip', 'install', '--upgrade', 'pip', '-q']);
run(python, ['-m', 'pip', 'install', '-r', 'requirements.txt']);

console.log('\n\x1b[32mOCR service ready.\x1b[0m  Start everything with:  npm run dev\n');
