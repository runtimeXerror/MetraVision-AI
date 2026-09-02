import type { Request, Response } from 'express';

import { logger } from '../config/logger';
import { assertRealImage } from '../middleware/upload';
import { Inspection, type InspectionDocument } from '../models/Inspection';
import { extractionService } from '../services/extraction';
import { ocrProvider, mockProviderFor, type MockFixtureId, MOCK_FIXTURE_IDS } from '../services/ocr';
import {
  runScan,
  type ScanOutcome,
  toLegacyChecks,
  toLegacyFields,
  toLegacyStatus,
  toLegacyViolations,
  scoreFor,
  renderReportHtml,
  buildReport,
} from '../services/scan';
import { storage } from '../services/storage';
import type { ImageType, ProductCategory } from '../types/domain';
import { ApiError } from '../utils/ApiError';
import { generateId, nextInspectionReference } from '../utils/referenceId';
import { created, ok } from '../utils/respond';
import type { ScanBody } from '../validators/scanSchemas';

import { getReport as legacyReport, loadInspection } from './inspection.controller';

/**
 * ── THE SCAN ENDPOINT ───────────────────────────────────────────────────────
 *
 *   POST /api/inspections/scan
 *
 * One call: photograph in, compliance report out. The controller does the three
 * things a controller should — authorise, validate, persist — and delegates
 * every judgement to `runScan`, which delegates the only judgement that matters
 * to the rule engine.
 *
 * On failure the inspection is kept in DRAFT with its images attached, rather
 * than deleted. An OCR outage is transient; an inspector standing in a shop
 * should be able to retry against the photographs they already uploaded instead
 * of taking them again.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Regions stored per inspection.
 *
 * A dense label can produce several hundred located lines across four images.
 * All of them are useful for an evidence overlay and none of them is useful
 * enough to risk the 16 MB document limit, so the store is capped and the full
 * text — which is what a re-extraction actually needs — is kept whole.
 */
const MAX_STORED_REGIONS = 400;

function filesFrom(req: Request): Express.Multer.File[] {
  const map = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (Array.isArray(req.files)) return req.files;
  return [...(map?.image ?? []), ...(map?.images ?? [])];
}

/** Resolves the provider for this request. A fixture may only be pinned by the mock. */
function providerFor(fixture: string | undefined) {
  if (!fixture) return undefined;

  if (ocrProvider.name !== 'mock') {
    throw ApiError.badRequest(
      'A mock OCR fixture can only be pinned while OCR_PROVIDER=mock.',
      'MOCK_FIXTURE_UNAVAILABLE',
    );
  }
  if (!MOCK_FIXTURE_IDS.includes(fixture as MockFixtureId)) {
    throw ApiError.badRequest(
      `"${fixture}" is not a known OCR fixture. Available: ${MOCK_FIXTURE_IDS.join(', ')}.`,
      'MOCK_FIXTURE_UNKNOWN',
    );
  }

  return mockProviderFor(fixture as MockFixtureId);
}

export async function scanInspection(req: Request, res: Response): Promise<Response> {
  const body = req.body as ScanBody;
  const uploads = filesFrom(req);

  if (uploads.length === 0) {
    throw ApiError.badRequest(
      'Attach at least one image of the package as `image` or `images`.',
      'NO_FILE',
    );
  }

  // A declared MIME type is a claim, not a fact. Checked before a byte reaches
  // storage or an OCR provider.
  for (const file of uploads) {
    assertRealImage(file.buffer, file.mimetype);
  }

  const provider = providerFor(body.mockFixture);

  /* ── The inspection record, created before the work starts ─────────────── */

  const inspection = await Inspection.create({
    inspectionId: await nextInspectionReference(),
    inspector: req.user!.id,
    // The scan flow is a quick capture and does not collect a premises record.
    // These are required by the schema; an inspector fills them in from the
    // detail screen, and a placeholder is more honest than a fabricated name.
    business: body.business ?? { name: 'Not recorded' },
    location: body.location ?? { address: 'Not recorded' },
    productCategory: body.productContext?.category as ProductCategory | undefined,
    notes: body.notes,
    images: [],
    extractedFields: [],
    status: 'PROCESSING',
  });

  /* ── Store the images ──────────────────────────────────────────────────── */

  const stored: Array<{ imageId: string; buffer: Buffer; mimeType: string }> = [];

  for (const [index, file] of uploads.entries()) {
    const object = await storage.put({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      prefix: `inspections/${inspection.inspectionId}`,
    });

    const imageId = generateId('img');
    const type: ImageType = index === 0 ? 'FRONT' : index === 1 ? 'BACK' : 'ADDITIONAL';

    inspection.images.push({
      imageId,
      type,
      storageKey: object.key,
      url: object.url,
      mimeType: object.mimeType,
      sizeBytes: object.sizeBytes,
      createdAt: new Date(),
    });

    stored.push({ imageId, buffer: file.buffer, mimeType: file.mimetype });
  }

  await inspection.save();

  /* ── The pipeline ──────────────────────────────────────────────────────── */

  let outcome: ScanOutcome;
  try {
    outcome = await runScan({
      inspectionId: inspection.inspectionId,
      inspectionDate: body.inspectionDate,
      productContext: body.productContext ?? {},
      images: stored,
      provider,
    });
  } catch (error) {
    // The record survives with its images so the inspector can retry. The
    // technical cause is logged; the client is told the scan failed and why in
    // terms it can act on.
    inspection.status = 'DRAFT';
    await inspection.save();

    const cause = error instanceof ApiError ? error : ApiError.internal();
    logger.error(
      { inspectionId: inspection.inspectionId, errorCode: cause.errorCode, stage: 'scan' },
      'scan failed',
    );

    throw new ApiError(
      cause.statusCode,
      'SCAN_FAILED',
      cause.message,
      {
        inspectionId: inspection.inspectionId,
        // The specific stage that failed, so a client can tell an outage from a
        // photograph it should retake.
        cause: cause.errorCode,
        retryable: cause.statusCode >= 500 || cause.errorCode === 'NO_TEXT_DETECTED',
      },
      // Written for the caller, and needed most when the cause was a 503.
      { exposeDetails: true },
    );
  }

  /* ── Persist ───────────────────────────────────────────────────────────── */

  await persistScan(inspection, outcome);

  const dto = inspection.toDTO();

  return created(
    res,
    {
      inspectionId: inspection.inspectionId,
      id: dto.id,
      status: outcome.compliance.status,

      ocr: {
        provider: outcome.ocr.provider,
        providerVersion: outcome.ocr.providerVersion,
        rawText: outcome.ocr.rawText,
        // Regions carry the boxes the mobile evidence overlay draws.
        regions: outcome.ocr.regions.slice(0, MAX_STORED_REGIONS),
        lineCount: outcome.ocr.regions.length,
        confidenceAvailable: outcome.ocr.confidenceAvailable,
        processingMs: outcome.ocr.processingTimeMs,
      },

      extractedData: {
        engine: outcome.extraction.engine,
        engineVersion: outcome.extraction.engineVersion,
        fields: outcome.extraction.fields,
        informational: outcome.extraction.informational,
        warnings: outcome.extraction.warnings,
      },

      compliance: {
        status: outcome.compliance.status,
        headline: outcome.report.overall.headline,
        summary: outcome.compliance.summary,
        checks: outcome.compliance.checks,
        issues: outcome.issues,
        issueSummary: outcome.issueSummary,
        warnings: outcome.compliance.warnings,
        applicableRules: outcome.compliance.applicableRules,
        ruleSetVersion: outcome.compliance.ruleSetVersion,
        ruleSetChecksum: outcome.compliance.ruleSetChecksum,
        engineVersion: outcome.compliance.engineVersion,
        thresholds: outcome.compliance.thresholds,
      },

      evidence: {
        images: dto.images,
        captureCompleteness: outcome.captureCompleteness,
        contextApplied: outcome.contextApplied,
        contextOverridden: outcome.contextOverridden,
      },

      report: {
        reportId: outcome.report.reportId,
        available: true,
        url: `/api/inspections/${inspection.inspectionId}/report`,
        disclaimer: outcome.report.disclaimer,
        limitations: outcome.report.limitations,
      },

      timings: outcome.timings,
    },
    outcome.report.overall.headline,
  );
}

/**
 * Writes the scan onto the inspection.
 *
 * Two representations, one write: the engine's result in full under `scan`,
 * and the projection the pre-existing screens read under `extractedFields`,
 * `aiAnalysis` and `complianceResult`. Nothing recomputes the second from the
 * first at read time, so a screen can never show a verdict the engine did not
 * produce.
 */
async function persistScan(inspection: InspectionDocument, outcome: ScanOutcome): Promise<void> {
  const { ocr, extraction, compliance, issues, issueSummary, report } = outcome;

  inspection.scan = {
    ocr: {
      provider: ocr.provider,
      providerVersion: ocr.providerVersion,
      rawText: ocr.rawText,
      lineCount: ocr.regions.length,
      characterCount: ocr.rawText.length,
      confidenceAvailable: ocr.confidenceAvailable,
      regions: ocr.regions.slice(0, MAX_STORED_REGIONS),
      processingMs: ocr.processingTimeMs,
      imageIds: inspection.images.map((image) => image.imageId),
    },
    extraction: {
      engine: extraction.engine,
      engineVersion: extraction.engineVersion,
      processingMs: extraction.processingTimeMs,
      fields: extraction.fields as unknown as Record<string, unknown>,
      informational: extraction.informational as unknown as Record<string, unknown>,
      contextSignals: extraction.contextSignals,
      unclaimedLines: extraction.unclaimedLines,
      warnings: extraction.warnings,
    },
    legal: {
      status: compliance.status,
      inspectionDate: compliance.inspectionDate,
      summary: compliance.summary as unknown as Record<string, unknown>,
      checks: compliance.checks,
      applicableRules: compliance.applicableRules,
      warnings: compliance.warnings,
      issues,
      issueSummary: issueSummary as unknown as Record<string, unknown>,
      thresholds: compliance.thresholds as unknown as Record<string, unknown>,
      ruleSetVersion: compliance.ruleSetVersion,
      ruleSetChecksum: compliance.ruleSetChecksum,
      engineVersion: compliance.engineVersion,
      evaluatedAt: new Date(compliance.evaluatedAt),
      durationMs: compliance.durationMs,
    },
    report: {
      reportId: report.reportId,
      generatedAt: new Date(report.generatedAt),
      reportVersion: report.reportVersion,
    },
    captureCompleteness: outcome.captureCompleteness,
    contextApplied: outcome.contextApplied,
    contextOverridden: outcome.contextOverridden,
    timings: outcome.timings,
    scannedAt: new Date(),
  };
  inspection.markModified('scan');

  inspection.extractedFields = toLegacyFields(extraction, compliance);

  const confidences = ocr.regions
    .map((region) => region.confidence)
    .filter((value): value is number => typeof value === 'number');

  inspection.aiAnalysis = {
    engine: ocr.provider === 'mock' ? 'MOCK' : 'OCR_API',
    engineVersion: `${ocr.provider}/${ocr.providerVersion ?? 'unknown'}+${extraction.engine}/${extraction.engineVersion}`,
    categoryValue: (inspection.productCategory ?? 'other') as ProductCategory,
    // The scan does not classify the commodity; the category comes from the
    // caller. Reporting a confidence for a classification nothing performed
    // would be inventing one, so it is zero and the field is honest.
    categoryConfidence: 0,
    origin: extraction.contextSignals.some((signal) => signal.key === 'isImported')
      ? 'IMPORTED'
      : 'DOMESTIC',
    meanConfidence:
      confidences.length > 0
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : 0,
    processingMs: outcome.timings.totalMs,
    imageIds: inspection.images.map((image) => image.imageId),
    analysedAt: new Date(),
    warnings: [...compliance.warnings.map((warning) => warning.message), ...extraction.warnings],
    // Every stored bbox is in the first image's own pixel space.
    bboxSpaceWidth: ocr.perImage[0]?.imageSize?.width ?? 0,
    bboxSpaceHeight: ocr.perImage[0]?.imageSize?.height ?? 0,
  };

  const legacyStatus = toLegacyStatus(compliance.status);

  inspection.complianceResult = {
    status: legacyStatus,
    score: scoreFor(compliance),
    checks: toLegacyChecks(compliance),
    violations: toLegacyViolations(issues),
    warnings: compliance.warnings.map((warning) => warning.message),
    ruleSetId: compliance.ruleSetVersion,
    ruleSetLabel: `Legal Metrology (Packaged Commodities) Rules, 2011 — as in force on ${compliance.inspectionDate}`,
    evaluatedAt: new Date(compliance.evaluatedAt),
  };

  inspection.status = legacyStatus;

  await inspection.save();
}

/**
 * `POST /api/inspections/:id/scan`
 *
 * Runs the same pipeline over the photographs already on an inspection.
 *
 * This is what the mobile capture flow calls: the inspector creates the record,
 * uploads faces one at a time as they photograph them, and then scans. It is
 * also the retry path after an OCR outage and the path a re-scan takes when the
 * OCR provider is replaced — none of which should require an inspector who has
 * left the shop to photograph the package again.
 */
export async function rescanInspection(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);

  if (inspection.status === 'FINALIZED') {
    throw ApiError.conflict(
      'This inspection has been finalized and can no longer be re-scanned.',
      'INSPECTION_FINALIZED',
    );
  }

  if (inspection.images.length === 0) {
    throw ApiError.badRequest(
      'Upload at least one image of the package before scanning.',
      'NO_IMAGES',
    );
  }

  const body = req.body as { inspectionDate?: string; productContext?: ScanBody['productContext']; mockFixture?: string };
  const provider = providerFor(body.mockFixture);

  const images: Array<{ imageId: string; buffer: Buffer; mimeType: string }> = [];
  for (const image of inspection.images) {
    if (!image.storageKey) continue;
    try {
      images.push({
        imageId: image.imageId,
        buffer: await storage.get(image.storageKey),
        mimeType: image.mimeType,
      });
    } catch {
      // A record whose bytes have gone is a storage problem, not a compliance
      // one, and it must not be scanned as though the package were blank.
      logger.error(
        { inspectionId: inspection.inspectionId, imageId: image.imageId },
        'stored image could not be read back',
      );
    }
  }

  if (images.length === 0) {
    throw ApiError.badRequest(
      'None of the images on this inspection could be read back from storage. Upload the photographs again.',
      'IMAGES_UNREADABLE',
    );
  }

  const previous = inspection.status;
  inspection.status = 'PROCESSING';
  await inspection.save();

  let outcome: ScanOutcome;
  try {
    outcome = await runScan({
      inspectionId: inspection.inspectionId,
      inspectionDate: body.inspectionDate ?? new Date().toISOString().slice(0, 10),
      productContext: {
        ...(inspection.productCategory ? { category: inspection.productCategory } : {}),
        ...(body.productContext ?? {}),
      },
      images,
      provider,
    });
  } catch (error) {
    // Never strand the record in PROCESSING — an inspector would have no way to
    // retry from the app.
    inspection.status = previous === 'PROCESSING' ? 'DRAFT' : previous;
    await inspection.save();

    const cause = error instanceof ApiError ? error : ApiError.internal();
    logger.error(
      { inspectionId: inspection.inspectionId, errorCode: cause.errorCode, stage: 'rescan' },
      'scan failed',
    );

    throw new ApiError(
      cause.statusCode,
      'SCAN_FAILED',
      cause.message,
      {
        inspectionId: inspection.inspectionId,
        cause: cause.errorCode,
        retryable: cause.statusCode >= 500 || cause.errorCode === 'NO_TEXT_DETECTED',
      },
      { exposeDetails: true },
    );
  }

  await persistScan(inspection, outcome);
  await inspection.populate('inspector', 'name inspectorId role');

  // The whole inspection, so the mobile app's existing screens — which read an
  // `InspectionDTO` — need no new shape to render the result.
  return ok(res, inspection.toDTO(), outcome.report.overall.headline);
}

/* ── The report ───────────────────────────────────────────────────────────── */

/**
 * `GET /api/inspections/:id/report`
 *
 * JSON by default; `?format=html` renders the printable version. The HTML is
 * generated from the same `ComplianceReport` object, so the two can never say
 * different things about the same inspection.
 */
export async function getReport(req: Request, res: Response): Promise<Response | void> {
  const inspection = await loadInspection(req);
  const dto = inspection.toDTO();
  const scan = inspection.scan;

  if (!scan) {
    // An inspection created through the older capture-and-review workflow keeps
    // the report it always had. Loaded once and branched here rather than in
    // the route, so the record is not fetched twice to decide which it is.
    return legacyReport(req, res);
  }

  const compliance = {
    inspectionId: inspection.inspectionId,
    // The date the rules were resolved against, as recorded by the scan.
    // Falling back to the evaluation date only for records written before that
    // was stored — those two dates are usually the same day, and where they are
    // not, the fallback is the best available.
    inspectionDate: scan.legal.inspectionDate ?? new Date(scan.legal.evaluatedAt).toISOString().slice(0, 10),
    status: scan.legal.status,
    summary: scan.legal.summary,
    checks: scan.legal.checks,
    applicableRules: scan.legal.applicableRules,
    warnings: scan.legal.warnings,
    ruleSetVersion: scan.legal.ruleSetVersion,
    ruleSetChecksum: scan.legal.ruleSetChecksum,
    sourceVersion: '',
    engineVersion: scan.legal.engineVersion,
    thresholds: scan.legal.thresholds,
    evaluatedAt: new Date(scan.legal.evaluatedAt).toISOString(),
    durationMs: scan.legal.durationMs,
  } as unknown as Parameters<typeof buildReport>[0]['compliance'];

  const report = buildReport({
    inspectionId: inspection.inspectionId,
    // The stored id, so a report regenerated a year later is recognisably the
    // same document rather than a new one.
    reportId: scan.report.reportId,
    generatedAt: new Date().toISOString(),
    inspectionDate: compliance.inspectionDate,
    inspector: {
      id: dto.inspector.id,
      name: dto.inspector.name,
      inspectorId: dto.inspector.inspectorId,
    },
    business: dto.business,
    location: { address: dto.location.address, district: dto.location.district, state: dto.location.state },
    images: dto.images.map((image) => ({
      imageId: image.imageId,
      url: image.url,
      type: image.type,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    })),
    ocr: {
      provider: scan.ocr.provider,
      providerVersion: scan.ocr.providerVersion,
      rawText: scan.ocr.rawText,
      regions: scan.ocr.regions as never,
      perImage: [],
      processingTimeMs: scan.ocr.processingMs,
      confidenceAvailable: scan.ocr.confidenceAvailable,
    },
    extraction: {
      engine: scan.extraction.engine,
      engineVersion: scan.extraction.engineVersion,
      fields: scan.extraction.fields as never,
      informational: scan.extraction.informational as never,
      contextSignals: scan.extraction.contextSignals as never,
      unclaimedLines: scan.extraction.unclaimedLines,
      warnings: scan.extraction.warnings,
      processingTimeMs: scan.extraction.processingMs,
      lineCount: scan.ocr.lineCount,
    },
    compliance,
    issues: scan.legal.issues as never,
    issueSummary: scan.legal.issueSummary as never,
    captureCompleteness: scan.captureCompleteness,
    contextApplied: scan.contextApplied as never,
    timings: scan.timings as never,
  });

  const format = (req.query.format as string | undefined)?.toLowerCase();

  if (format === 'html') {
    res.type('html').send(renderReportHtml(report));
    return;
  }

  /**
   * The scan report, plus the presentation block the older report screen reads.
   *
   * A superset rather than a replacement, and that is a correction: when this
   * endpoint began branching to the scan report, the mobile report screen —
   * which parses `extractedFields` as `{ name, aiValue, confidence }` and
   * needs `complianceResult`, `notes` and `status` — received a payload with
   * none of those and failed outright. The document an inspector could no
   * longer open was the one the whole flow exists to produce.
   *
   * The legacy half is the same projection stored on the inspection, so the two
   * halves cannot disagree: both are derived from one scan record. The screen
   * will eventually be rewritten against the sections above, at which point
   * this block goes.
   */
  return ok(res, {
    ...report,

    // Merged into `product` rather than added beside it: the report screen
    // reads `product.category`, and a second top-level key would have looked
    // present in the payload while still being invisible to the caller.
    product: { ...report.product, category: dto.productCategory },
    extractedFields: dto.extractedFields,
    aiAnalysis: dto.aiAnalysis,
    complianceResult: dto.complianceResult,
    review: dto.review,
    notes: [dto.notes, dto.finalNotes].filter(Boolean),
    status: dto.status,
    createdAt: dto.createdAt,
    finalizedAt: dto.finalizedAt,
  });
}

/** What the scan pipeline is currently configured to do. */
export async function getScanStatus(_req: Request, res: Response): Promise<Response> {
  const hint = ocrProvider.configurationHint();

  return ok(res, {
    ocrProvider: ocrProvider.name,
    ocrProviderVersion: ocrProvider.version,
    ocrConfigured: ocrProvider.isConfigured(),
    ...(hint ? { setupRequired: hint } : {}),
    extractionEngine: extractionService.engine,
    extractionEngineVersion: extractionService.engineVersion,
    availableMockFixtures: ocrProvider.name === 'mock' ? MOCK_FIXTURE_IDS : [],
    // Restated on the wire so a client cannot assume otherwise.
    usesLlmForDecisions: false,
    decisionsMadeBy: 'lm-rule-engine',
  });
}
