import { promises as fs } from 'node:fs';
import path from 'node:path';

import { env } from '../config/env';
import { storage } from '../services/storage';
import type { ProductCategory } from '../types/domain';

import { renderLabelSvg, type LabelField } from './labelImage';

/**
 * Writes the synthetic label images seeded inspections carry.
 *
 * Deliberately bypasses `storage.put()` and writes with a deterministic key.
 * `put()` mints a random filename on every call, which is right for an
 * inspector's upload — a predictable name invites enumeration — but wrong here:
 * re-running the seed would then pile up orphaned copies of the same label
 * instead of overwriting it.
 *
 * The URL is still produced by the provider, so the served path stays whatever
 * the active storage provider says it is.
 */

const PREFIX = 'seed';

export interface SeedLabelInput {
  imageId: string;
  face: string;
  productName: string;
  category: ProductCategory;
  fields: LabelField[];
}

export interface StoredSeedLabel {
  key: string;
  url: string;
  sizeBytes: number;
}

export async function writeSeedLabel(input: SeedLabelInput): Promise<StoredSeedLabel> {
  const svg = renderLabelSvg({
    productName: input.productName,
    category: input.category,
    face: input.face,
    fields: input.fields,
  });

  const buffer = Buffer.from(svg, 'utf8');
  const key = path.posix.join(PREFIX, `${input.imageId}.svg`);
  const absolutePath = path.join(env.uploadPath, key);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  return {
    key,
    url: storage.urlFor(key),
    sizeBytes: buffer.byteLength,
  };
}

/** Clears previously generated labels so a reset seed does not leave strays. */
export async function clearSeedLabels(): Promise<void> {
  const directory = path.join(env.uploadPath, PREFIX);
  try {
    await fs.rm(directory, { recursive: true, force: true });
  } catch {
    // A missing directory is the desired end state.
  }
}
