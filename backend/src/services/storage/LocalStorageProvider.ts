import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '../../config/env';
import { logger } from '../../config/logger';

import type { PutObjectInput, StorageProvider, StoredObject } from './StorageProvider';

/**
 * Local-disk storage for development.
 *
 * Files land under `UPLOAD_DIR` and are served statically by Express at
 * `/uploads`. Adequate for a single-node demo; a real deployment swaps in an
 * object-storage provider behind the same interface.
 */

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  async put(input: PutObjectInput): Promise<StoredObject> {
    const extension =
      EXTENSIONS[input.mimeType] ?? path.extname(input.originalName).toLowerCase() ?? '.bin';

    // Random filename rather than the client's: an inspector-supplied name is
    // untrusted input, and a predictable one invites enumeration.
    const filename = `${Date.now()}-${randomBytes(6).toString('hex')}${extension}`;
    const relativeKey = path.posix.join(input.prefix, filename);
    const absolutePath = path.join(env.uploadPath, relativeKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer);

    logger.debug({ key: relativeKey, bytes: input.buffer.byteLength }, 'stored image');

    return {
      key: relativeKey,
      url: this.urlFor(relativeKey),
      sizeBytes: input.buffer.byteLength,
      mimeType: input.mimeType,
    };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveInsideRoot(key, 'read'));
  }

  async delete(key: string): Promise<void> {
    const absolutePath = this.resolveInsideRoot(key, 'delete');

    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      // A missing file is the desired end state; only surface real failures.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  urlFor(key: string): string {
    return `/uploads/${key}`;
  }

  /**
   * Resolves a stored key against the upload root, refusing to leave it.
   *
   * The keys this provider mints cannot contain `..`, but a key read back out
   * of a database is input like any other, and one traversal bug is the
   * difference between serving a label photograph and serving `/etc/shadow`.
   */
  private resolveInsideRoot(key: string, operation: string): string {
    const root = path.resolve(env.uploadPath);
    const absolutePath = path.resolve(path.join(env.uploadPath, key));

    if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
      logger.warn({ key, operation }, 'refused a storage key that escapes the upload root');
      throw new Error(`Refused to ${operation} outside the upload root.`);
    }

    return absolutePath;
  }

  /** Stable identity for a buffer, used to detect duplicate uploads. */
  static checksum(buffer: Buffer): string {
    return createHash('sha1').update(buffer).digest('hex');
  }
}
