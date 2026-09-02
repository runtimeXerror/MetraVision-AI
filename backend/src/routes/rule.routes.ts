import { Router } from 'express';

import * as legalController from '../controllers/legalRule.controller';
import * as controller from '../controllers/rule.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { applicableRulesQuerySchema, listLegalRulesQuerySchema, ruleHistoryQuerySchema } from '../validators/complianceSchemas';
import { createRuleSchema, listRulesQuerySchema, ruleStatusSchema, updateRuleSchema } from '../validators/schemas';

const router = Router();

router.use(authenticate);

/**
 * Two rule surfaces live under this router, and they are not the same thing.
 *
 *   /api/rules                 the Phase 3 catalogue — one editable record per
 *                              declaration requirement, what the dashboard
 *                              lists and what an admin can amend.
 *
 *   /api/rules/legal[/:ruleId] the Phase 4A versioned corpus — one record per
 *   /api/rules/applicable      *version* of a requirement, read-only, sourced
 *                              to a Gazette notification. This is what the
 *                              rule engine evaluates.
 *
 * They are kept apart rather than merged because they answer different
 * questions. The catalogue says what the department currently asks inspectors
 * to look for; the corpus says what the law said on a particular day. Folding
 * the second into the first would make the editable records look authoritative,
 * which is precisely the confusion this phase exists to remove.
 *
 * The literal sub-paths are registered before `/:id`, or Express would route
 * `/api/rules/applicable` into the catalogue's lookup and return a 404.
 */
router.get('/', validateQuery(listRulesQuerySchema), asyncHandler(controller.listRules));

router.get('/applicable', validateQuery(applicableRulesQuerySchema), asyncHandler(legalController.listApplicableRules));
router.get('/legal', validateQuery(listLegalRulesQuerySchema), asyncHandler(legalController.listLegalRules));
router.get('/legal/:ruleId', validateQuery(ruleHistoryQuerySchema), asyncHandler(legalController.getLegalRule));

router.get('/:id', asyncHandler(controller.getRule));

router.post('/', requireRole('ADMIN'), validateBody(createRuleSchema), asyncHandler(controller.createRule));
router.patch('/:id', requireRole('ADMIN'), validateBody(updateRuleSchema), asyncHandler(controller.updateRule));
router.post(
  '/:id/status',
  requireRole('ADMIN'),
  validateBody(ruleStatusSchema),
  asyncHandler(controller.setRuleStatus),
);

export default router;
