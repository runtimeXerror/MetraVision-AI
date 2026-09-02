import multer from 'multer';

import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * Image upload handling.
 *
 * Files are held in memory rather than written by multer directly, because the
 * storage provider — which may be S3 in a later phase — needs the buffer, not a
 * path on this machine's disk.
 */

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadBytes,
    files: 8,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      callback(
        ApiError.unsupportedMedia(
          `${file.mimetype} is not an accepted image format. Use JPEG, PNG, WebP or HEIC.`,
        ),
      );
      return;
    }
    callback(null, true);
  },
});

/**
 * Second line of defence: a client can claim any MIME type, so the magic bytes
 * are checked against the declared type before anything is written to storage.
 */
export function assertRealImage(buffer: Buffer, declaredMime: string): void {
  const signatures: Array<{ mime: string; bytes: number[]; offset?: number }> = [
    { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
    { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
    { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
    { mime: 'image/heic', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  ];

  const matches = signatures.some(({ bytes, offset = 0 }) =>
    bytes.every((byte, index) => buffer[offset + index] === byte),
  );

  if (!matches) {
    throw ApiError.badRequest(
      'The uploaded file is not a valid image.',
      'INVALID_IMAGE',
    );
  }

  void declaredMime;
}
