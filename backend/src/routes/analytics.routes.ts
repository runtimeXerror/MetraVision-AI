import { Router } from 'express';

import * as controller from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { analyticsQuerySchema } from '../validators/schemas';

/**
 * Dashboard analytics.
 *
 * Open to any signed-in caller, because the scope is derived from the token
 * rather than the query: an inspector asking for the summary gets their own
 * numbers, which is a legitimate thing for them to see.
 */

const router = Router();

router.use(authenticate);
router.use(validateQuery(analyticsQuerySchema));

// One call for the overview page; the individual endpoints back the drill-downs.
router.get('/overview', asyncHandler(controller.getOverview));
router.get('/summary', asyncHandler(controller.getSummary));
router.get('/trend', asyncHandler(controller.getTrend));
router.get('/distribution', asyncHandler(controller.getDistribution));
router.get('/violations-by-category', asyncHandler(controller.getViolationsByCategory));
router.get('/violation-types', asyncHandler(controller.getViolationTypes));
router.get('/inspector-activity', asyncHandler(controller.getInspectorActivity));
router.get('/districts', asyncHandler(controller.getDistricts));

export default router;
