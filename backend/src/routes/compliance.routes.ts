import { Router } from 'express';

import * as controller from '../controllers/compliance.controller';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { evaluateComplianceSchema } from '../validators/complianceSchemas';

const router = Router();

router.use(authenticate);

router.get('/status', asyncHandler(controller.getEngineStatus));

router.post('/evaluate', validateBody(evaluateComplianceSchema), asyncHandler(controller.evaluate));

// Registered after `/status` and `/evaluate` so neither is swallowed by the
// parameter route.
router.get('/:inspectionId', asyncHandler(controller.getEvaluations));

export default router;
