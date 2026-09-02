import { Router } from 'express';

import { env } from '../config/env';
import { isEphemeralDatabase } from '../config/db';
import { analysisProvider } from '../services/analysisService';
import { extractionService } from '../services/extraction';
import { ocrProvider } from '../services/ocr';
import { storage } from '../services/storage';

import analyticsRoutes from './analytics.routes';
import authRoutes from './auth.routes';
import complianceRoutes from './compliance.routes';
import inspectionRoutes from './inspection.routes';
import { amendmentRouter, ruleSourceRouter, ruleValidationRouter } from './legalRule.routes';
import productRoutes from './product.routes';
import ruleRoutes from './rule.routes';
import userRoutes from './user.routes';
import violationRoutes from './violation.routes';

const router = Router();

/**
 * Health and capability probe.
 *
 * Reports which providers are active so a client — or a judge at a demo — can
 * see at a glance that the analysis is the mock one.
 */
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      environment: env.NODE_ENV,
      database: isEphemeralDatabase() ? 'in-memory (ephemeral)' : 'mongodb',
      analysisProvider: analysisProvider.name,
      storageProvider: storage.name,
      /**
       * The scan pipeline's configuration, so a client — or a judge at a demo —
       * can see at a glance whether a live OCR provider is behind the results
       * or the deterministic fixtures are. Names and flags only; a credential
       * never appears here.
       */
      ocr: {
        provider: ocrProvider.name,
        version: ocrProvider.version,
        configured: ocrProvider.isConfigured(),
      },
      extraction: {
        engine: extractionService.engine,
        version: extractionService.engineVersion,
      },
      usesLlmForDecisions: false,
      phase: 'Phase 4B — end-to-end scan: OCR → extraction → Legal Metrology rule engine → report',
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/inspections', inspectionRoutes);

// Phase 3 — the web dashboard's read models.
router.use('/analytics', analyticsRoutes);
router.use('/violations', violationRoutes);
router.use('/products', productRoutes);
router.use('/rules', ruleRoutes);

// Phase 4A — the Legal Metrology rule engine and the versioned corpus behind it.
router.use('/compliance', complianceRoutes);
router.use('/amendments', amendmentRouter);
router.use('/rule-sources', ruleSourceRouter);
router.use('/rule-validation', ruleValidationRouter);

export default router;
