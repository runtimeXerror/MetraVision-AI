import { Router } from 'express';

import * as controller from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from '../validators/schemas';

const router = Router();

// Credential endpoints carry the tighter limiter — these are the ones worth
// brute-forcing.
router.post('/register', authRateLimiter, validateBody(registerSchema), asyncHandler(controller.register));
router.post('/login', authRateLimiter, validateBody(loginSchema), asyncHandler(controller.login));
router.post('/refresh', authRateLimiter, validateBody(refreshSchema), asyncHandler(controller.refresh));
router.post('/logout', validateBody(logoutSchema), asyncHandler(controller.logout));
router.get('/me', authenticate, asyncHandler(controller.me));

export default router;
