import { Router } from 'express';

import { env } from '../config/env';
import { isEphemeralDatabase } from '../config/db';
import { analysisProvider } from '../services/analysisService';
import { extractionService } from '../services/extraction';
import { llmProvider } from '../services/llm';
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
      /**
       * The optional model stage.
       *
       * Reported in more detail than the others because it is the only stage
       * that fails silently: an OCR outage stops the scan and says so, while a
       * spent quota or a rejected key leaves the scan completing normally with
       * the corrections quietly missing. `enabled` and `configured` say what
       * was asked for; `lastCall` says what actually happened, which is the
       * only one of the three that can tell you the stage is working.
       */
      llm: {
        provider: llmProvider.name,
        model: llmProvider.model,
        /** `LLM_PROVIDER` names a model. */
        enabled: env.LLM_PROVIDER !== 'none',
        /** A key is present. Not that it is valid — see `lastCall`. */
        configured: llmProvider.isConfigured(),
        timeoutMs: env.LLM_TIMEOUT_MS,
        hint: llmProvider.configurationHint(),
        lastCall: llmProvider.lastOutcome?.() ?? null,
      },
      usesLlmForDecisions: false,
      phase: 'Phase 4B — end-to-end scan: OCR → extraction → Legal Metrology rule engine → report',
    },
  });
});

/**
 * Live probe for the model stage.
 *
 * Separate from `/health` and never called by it, because this one spends
 * quota: it sends a short line of deliberately corrupted text and reports what
 * came back. `/health` must stay free to poll.
 *
 * The sample carries the three substitutions the camera actually makes — `O`
 * for `0`, `l` for `1`, `S` for `5` — so a model that returns it unrepaired
 * has failed the probe even though the call succeeded. That distinction is the
 * point: `gemini-3.5-flash-lite` answers this endpoint in two seconds and
 * corrects nothing.
 */
router.get('/health/llm', async (_req, res) => {
  if (env.LLM_PROVIDER === 'none') {
    res.json({
      success: true,
      data: { enabled: false, note: 'LLM_PROVIDER is none — no model is asked for.' },
    });
    return;
  }

  const probe = 'M.R.P. Rs. 1S8.OO\nNet Qty: 5OO mI\nCountry of Origin: lndia';
  const startedAt = Date.now();
  const reading = await llmProvider.read({
    text: probe,
    inspectionId: 'health-probe',
  });

  const repaired = reading.suggestions.filter((one) => one.correctedFrom);

  res.json({
    success: true,
    data: {
      enabled: true,
      configured: llmProvider.isConfigured(),
      provider: reading.provider,
      model: reading.model,
      ms: Date.now() - startedAt,
      /** The call returned and the model repaired at least one character. */
      working: repaired.length > 0,
      outcome: llmProvider.lastOutcome?.() ?? null,
      sentToModel: probe,
      readBack: reading.suggestions.map((one) => ({
        field: one.field,
        value: one.value,
        correctedFrom: one.correctedFrom ?? null,
      })),
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
