/**
 * Where the OCR service's interpreter lives.
 *
 * Shared by every root script, because getting it wrong is the one failure
 * that produces an unhelpful error: a missing interpreter surfaces as
 * "command not found" from a tool that cannot say which command it meant.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ocrDir = path.join(root, 'ocr-service');
export const backendDir = path.join(root, 'backend');

export const isWindows = process.platform === 'win32';

/** The venv interpreter, or `null` when the environment has not been created. */
export function pythonPath() {
  const candidates = isWindows
    ? [path.join(ocrDir, '.venv', 'Scripts', 'python.exe')]
    : [path.join(ocrDir, '.venv', 'bin', 'python3'), path.join(ocrDir, '.venv', 'bin', 'python')];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** The message printed when the environment is missing, in one place. */
export const SETUP_HINT = [
  '',
  'The OCR service has no virtual environment yet. Create it with:',
  '',
  '    npm run setup:ocr',
  '',
  'The first run downloads the official pretrained weights (a minute or two,',
  'needs a network connection) and caches them outside the repository; every',
  'start after that is offline. See ocr-service/README.md.',
  '',
].join('\n');
