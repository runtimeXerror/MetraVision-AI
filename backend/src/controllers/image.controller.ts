import type { Request, Response } from 'express';

import { assertRealImage } from '../middleware/upload';
import { storage } from '../services/storage';
import type { ImageType } from '../types/domain';
import { ApiError } from '../utils/ApiError';
import { generateId } from '../utils/referenceId';
import { created, ok } from '../utils/respond';

import { loadInspection } from './inspection.controller';

/**
 * Inspection images.
 *
 * `loadInspection` performs the ownership check, so these handlers never repeat
 * the authorisation logic. Bytes go to the configured storage provider; only
 * the returned key and URL are persisted on the inspection.
 */

export async function uploadImages(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);

  if (inspection.status === 'FINALIZED') {
    throw ApiError.conflict(
      'This inspection has been finalized and can no longer be modified.',
      'INSPECTION_FINALIZED',
    );
  }

  // The route accepts a single `image` or a repeated `images` field.
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const single = req.file ? [req.file] : [];
  const uploads = [...files, ...single];

  if (uploads.length === 0) {
    throw ApiError.badRequest('No image file was included in the request.', 'NO_FILE');
  }

  const type = ((req.body as { type?: string }).type ?? 'FRONT').toUpperCase() as ImageType;

  const stored = [];
  for (const file of uploads) {
    // Magic-byte check: a client can claim any MIME type it likes.
    assertRealImage(file.buffer, file.mimetype);

    const object = await storage.put({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      prefix: `inspections/${inspection.inspectionId}`,
    });

    const image = {
      imageId: generateId('img'),
      type,
      storageKey: object.key,
      url: object.url,
      mimeType: object.mimeType,
      sizeBytes: object.sizeBytes,
      createdAt: new Date(),
    };

    inspection.images.push(image);
    stored.push(image);
  }

  await inspection.save();

  return created(
    res,
    {
      inspectionId: inspection.inspectionId,
      images: stored.map((image) => ({
        imageId: image.imageId,
        inspectionId: inspection.inspectionId,
        type: image.type,
        url: image.url,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        createdAt: image.createdAt.toISOString(),
      })),
    },
    `${stored.length} image${stored.length === 1 ? '' : 's'} uploaded`,
  );
}

export async function listImages(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);

  return ok(
    res,
    inspection.images.map((image) => ({
      imageId: image.imageId,
      inspectionId: inspection.inspectionId,
      type: image.type,
      url: image.url,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      createdAt: image.createdAt.toISOString(),
    })),
  );
}

export async function deleteImage(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);

  if (inspection.status === 'FINALIZED') {
    throw ApiError.conflict(
      'This inspection has been finalized and can no longer be modified.',
      'INSPECTION_FINALIZED',
    );
  }

  const { imageId } = req.params as { imageId: string };
  const index = inspection.images.findIndex((image) => image.imageId === imageId);

  if (index === -1) {
    throw ApiError.notFound('That image is not part of this inspection.', 'IMAGE_NOT_FOUND');
  }

  const [removed] = inspection.images.splice(index, 1);
  await inspection.save();

  // Storage cleanup must not fail the request: the authoritative record is the
  // inspection document, and an orphaned file is a housekeeping problem rather
  // than a correctness one.
  if (removed) {
    await storage.delete(removed.storageKey).catch(() => undefined);
  }

  return ok(res, { deleted: true, imageId }, 'Image deleted');
}
