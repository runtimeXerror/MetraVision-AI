import { env } from '../../config/env';

import { LocalStorageProvider } from './LocalStorageProvider';
import type { StorageProvider } from './StorageProvider';

/**
 * Resolves the configured provider once at boot.
 *
 * Phase 3: add `case 's3': return new S3StorageProvider()` here. Nothing else
 * in the codebase needs to change.
 */
function createStorageProvider(): StorageProvider {
  switch (env.STORAGE_PROVIDER) {
    case 'local':
    default:
      return new LocalStorageProvider();
  }
}

export const storage: StorageProvider = createStorageProvider();
export type { StorageProvider, StoredObject, PutObjectInput } from './StorageProvider';
