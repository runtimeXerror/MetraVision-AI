import { Router } from 'express';

import * as controller from '../controllers/violation.controller';
import { authenticate } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { listViolationsQuerySchema } from '../validators/schemas';

const router = Router();

router.use(authenticate);

// Declared before `/:id` so "stats" is not parsed as a violation reference.
router.get('/stats', validateQuery(listViolationsQuerySchema), asyncHandler(controller.getViolationStats));
router.get('/', validateQuery(listViolationsQuerySchema), asyncHandler(controller.listViolations));
router.get('/:id', asyncHandler(controller.getViolation));

export default router;
