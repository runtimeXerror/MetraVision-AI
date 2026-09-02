import { Router } from 'express';

import * as controller from '../controllers/product.controller';
import { authenticate } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { listProductsQuerySchema } from '../validators/schemas';

const router = Router();

router.use(authenticate);
router.get('/', validateQuery(listProductsQuerySchema), asyncHandler(controller.listProducts));

export default router;
