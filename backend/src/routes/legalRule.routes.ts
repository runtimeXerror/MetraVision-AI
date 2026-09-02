import { Router } from 'express';

import * as controller from '../controllers/legalRule.controller';
import { authenticate } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { listAmendmentsQuerySchema, validationReportQuerySchema } from '../validators/complianceSchemas';

/**
 * The corpus's own routers: `/api/amendments`, `/api/rule-sources` and
 * `/api/rule-validation`.
 *
 * All read-only, for every role. An inspector is entitled to see the provision
 * they are enforcing and the notification it came from; nobody edits a Gazette
 * through an HTTP endpoint.
 */

export const amendmentRouter = Router();
amendmentRouter.use(authenticate);
amendmentRouter.get('/', validateQuery(listAmendmentsQuerySchema), asyncHandler(controller.listAmendments));
amendmentRouter.get('/:notification', asyncHandler(controller.getAmendment));

export const ruleSourceRouter = Router();
ruleSourceRouter.use(authenticate);
ruleSourceRouter.get('/', asyncHandler(controller.listRuleSources));

export const ruleValidationRouter = Router();
ruleValidationRouter.use(authenticate);
ruleValidationRouter.get('/report', validateQuery(validationReportQuerySchema), asyncHandler(controller.getValidationReport));
