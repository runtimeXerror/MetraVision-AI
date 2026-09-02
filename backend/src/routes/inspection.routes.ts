import { Router } from 'express';

import * as images from '../controllers/image.controller';
import * as controller from '../controllers/inspection.controller';
import * as scan from '../controllers/scan.controller';
import { authenticate } from '../middleware/auth';
import { imageUpload } from '../middleware/upload';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  analyzeSchema,
  bulkReviewSchema,
  createInspectionSchema,
  finalizeSchema,
  imageIdParam,
  inspectionIdParam,
  listInspectionsQuerySchema,
  reviewSchema,
  updateInspectionSchema,
} from '../validators/schemas';
import { rescanSchema, scanSchema } from '../validators/scanSchemas';

const router = Router();

// Every inspection route requires a signed-in caller.
router.use(authenticate);

/* Collection */
router.post('/', validateBody(createInspectionSchema), asyncHandler(controller.createInspection));
router.get('/', validateQuery(listInspectionsQuerySchema), asyncHandler(controller.listInspections));

// Declared before `/:id` so "stats" is not parsed as an inspection identifier.
router.get('/stats', asyncHandler(controller.getStats));

/**
 * The one-call scan: photograph in, compliance report out.
 *
 * Declared before `/:id` for the same reason `stats` is. Multer runs before the
 * body validator because the body does not exist until multipart has been
 * parsed; the file-count and size limits are enforced by `imageUpload` itself.
 */
router.post(
  '/scan',
  imageUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: 8 },
  ]),
  validateBody(scanSchema),
  asyncHandler(scan.scanInspection),
);

/** What the scan pipeline is configured to do, and whether it is set up. */
router.get('/scan/status', asyncHandler(scan.getScanStatus));

/* Single record */
router.get('/:id', validateParams(inspectionIdParam), asyncHandler(controller.getInspection));
router.patch(
  '/:id',
  validateParams(inspectionIdParam),
  validateBody(updateInspectionSchema),
  asyncHandler(controller.updateInspection),
);
router.delete('/:id', validateParams(inspectionIdParam), asyncHandler(controller.deleteInspection));

/* Images */
router.post(
  '/:id/images',
  validateParams(inspectionIdParam),
  imageUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: 8 },
  ]),
  asyncHandler(async (req, res) => {
    // Normalise multer's field map into the flat array the controller expects.
    const map = req.files as Record<string, Express.Multer.File[]> | undefined;
    req.files = [...(map?.image ?? []), ...(map?.images ?? [])];
    await images.uploadImages(req, res);
  }),
);
router.get('/:id/images', validateParams(inspectionIdParam), asyncHandler(images.listImages));
router.delete('/:id/images/:imageId', validateParams(imageIdParam), asyncHandler(images.deleteImage));

/* Workflow */
router.post(
  '/:id/analyze',
  validateParams(inspectionIdParam),
  validateBody(analyzeSchema),
  asyncHandler(controller.analyzeInspection),
);
/**
 * Runs the OCR → extraction → rule-engine pipeline over the images already on
 * this inspection. The capture flow's processing step, and the retry path.
 */
router.post(
  '/:id/scan',
  validateParams(inspectionIdParam),
  validateBody(rescanSchema),
  asyncHandler(scan.rescanInspection),
);
router.post(
  '/:id/review',
  validateParams(inspectionIdParam),
  // Accepts one decision or a batch, so the mobile review screen can submit
  // either as the inspector works through the fields.
  validateBody(reviewSchema.or(bulkReviewSchema)),
  asyncHandler(controller.reviewInspection),
);
router.post(
  '/:id/finalize',
  validateParams(inspectionIdParam),
  validateBody(finalizeSchema),
  asyncHandler(controller.finalizeInspection),
);
/**
 * The report.
 *
 * A scanned inspection is served the full OCR → extraction → rule-engine
 * report; one created through the older workflow keeps the report it always
 * had. Branching here rather than inside one handler keeps the two document
 * shapes from growing into each other.
 */
router.get('/:id/report', validateParams(inspectionIdParam), asyncHandler(scan.getReport));

export default router;
