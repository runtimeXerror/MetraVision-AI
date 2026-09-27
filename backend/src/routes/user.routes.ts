import { Router } from 'express';

import * as controller from '../controllers/user.controller';
import { authenticate, requireAtLeast, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  changePasswordSchema,
  createInspectorSchema,
  updateProfileSchema,
} from '../validators/schemas';

const router = Router();

router.use(authenticate);

router.get('/me', asyncHandler(controller.getProfile));
router.patch('/me', validateBody(updateProfileSchema), asyncHandler(controller.updateProfile));
router.post('/me/password', validateBody(changePasswordSchema), asyncHandler(controller.changePassword));

// The roster is a supervisory view, not something an inspector needs.
router.get('/', requireAtLeast('SUPERVISOR'), asyncHandler(controller.listUsers));

// Enrolling an officer is an administrative act: a supervisor can see the
// roster, only an administrator can add to it.
router.post(
  '/',
  requireRole('ADMIN'),
  validateBody(createInspectorSchema),
  asyncHandler(controller.createInspector),
);

export default router;
