import { ENGINE_VERSION } from '../compliance/rule-engine/RuleEngine';
import { logger } from '../config/logger';
import { reevaluateFromScan } from '../controllers/inspection.controller';
import { Inspection } from '../models/Inspection';

/**
 * ── RECORDS WRITTEN UNDER THE OLDER ENGINE ──────────────────────────────────
 *
 * The rule engine used to have a third answer, REVIEW_REQUIRED, and the
 * register carries records that were left in it. Nothing produces that state
 * any more and nothing displays it, so a record still holding it would be
 * stuck: not a verdict the app can show, not a status the schema accepts on
 * the next save.
 *
 * Every such record is re-evaluated on boot, under the current engine, from
 * the reading the scan stored and the determinations the inspector recorded —
 * the same path a review takes. A record from the legacy analyse route, which
 * has no stored scan to re-run, is settled from what it already holds: a
 * violation on file makes it non-compliant, otherwise it is compliant.
 *
 * Idempotent, and cheap once done: a record is touched only while it carries
 * the old state or an older engine version.
 */
export async function migrateReviewStates(): Promise<{ reevaluated: number; settled: number }> {
  const candidates = await Inspection.find({
    $or: [
      { status: 'REVIEW_REQUIRED' },
      { 'complianceResult.status': 'REVIEW_REQUIRED' },
      { 'scan.legal.engineVersion': { $exists: true, $ne: ENGINE_VERSION } },
    ],
  });

  let reevaluated = 0;
  let settled = 0;

  for (const inspection of candidates) {
    try {
      if (inspection.scan) {
        await reevaluateFromScan(inspection, new Date());
        reevaluated += 1;
      } else if (inspection.complianceResult) {
        const verdict = inspection.complianceResult.violations.length > 0 ? 'VIOLATION_DETECTED' : 'COMPLIANT';
        inspection.complianceResult.status = verdict;
        if (inspection.status !== 'FINALIZED') inspection.status = verdict;
        inspection.markModified('complianceResult');
        settled += 1;
      } else {
        inspection.status = 'DRAFT';
        settled += 1;
      }

      await inspection.save({ validateBeforeSave: false });
    } catch (error) {
      logger.warn({ inspectionId: inspection.inspectionId, err: error }, 'could not migrate inspection');
    }
  }

  if (reevaluated + settled > 0) {
    logger.info({ reevaluated, settled }, 'inspections moved off the retired review state');
  }

  return { reevaluated, settled };
}
