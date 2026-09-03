import { randomBytes } from 'node:crypto';

import { evaluateCompliance } from '../../compliance/ruleEngineService';
import type { ComplianceResult } from '../../compliance/types/ComplianceResult';
import { logger } from '../../config/logger';
import type { ExtractedFieldRecord, ExtractionResult } from '../extraction';
import type { AggregateOCRResult } from '../ocr';

import { toComplianceRequest, type ScanProductContext } from './ComplianceInputAdapter';
import { generateIssues, type ComplianceIssue, type IssueSummary } from './issueGenerator';
import { buildReport, type ComplianceReport } from './reportGenerator';

/**
 * ── RE-EVALUATION AFTER THE INSPECTOR HAS CHECKED THE PACKAGE ───────────────
 *
 * The inspector is standing in front of the product. They can see what the
 * camera could not, and they can see when the camera read something wrong.
 * This stage takes what they determined and runs the *same* Legal Metrology
 * rule engine over it that the scan ran — not a second, simpler checker.
 *
 * That distinction is the whole point of this file. Before it, a correction
 * made on the review screen was re-checked by the older scripted analyser in
 * `services/complianceService`, which knows nothing about rule versions,
 * exceptions, or the evidence policy in `DecisionEngine`. So the report an
 * inspector signed could be produced by a different set of rules from the one
 * the scan had just applied, and a corrected value could turn a finding into a
 * pass under rules that were never the law. Findings have to come from one
 * rulebook, and this routes the verified values back through it.
 *
 * ── What the inspector's word changes ──────────────────────────────────────
 *
 * Three determinations, and they are not the same thing:
 *
 *   ACCEPTED           the reading was right. `HUMAN_VERIFIED`, and the
 *                      engine stops discounting it for low OCR confidence —
 *                      a person has now seen it.
 *   EDITED             the reading was wrong; here is the value on the
 *                      package. Also `HUMAN_VERIFIED`, with the corrected
 *                      value. The original OCR reading is *not* touched.
 *   MARKED_UNAVAILABLE the declaration is genuinely not on the package.
 *                      `HUMAN_MARKED_ABSENT` with `absenceConfidence: 1` —
 *                      the one thing that can turn "we did not find it" into
 *                      a violation, because a person looked.
 *
 * A declaration the inspector did not rule on is left exactly as the scan left
 * it: still `NOT_FOUND`, still weak, still routed to review. Silence is not
 * confirmation, and treating it as such is how an unchecked box becomes a
 * finding against a trader.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type VerificationAction = 'ACCEPTED' | 'EDITED' | 'MARKED_UNAVAILABLE';

export interface FieldVerification {
  /** Rule-set field name, e.g. `mrp`. */
  field: string;
  action: VerificationAction;
  /** The value the inspector read off the package. `EDITED` only. */
  value?: string | null;
}

export interface ReevaluationInput {
  inspectionId: string;
  inspectionDate: string;
  productContext: ScanProductContext;
  /** The extraction the scan produced, exactly as stored. Never mutated. */
  extraction: ExtractionResult;
  /** The OCR aggregate the scan produced, for provenance and capture policy. */
  ocr: AggregateOCRResult;
  imageIds: string[];
  verifications: FieldVerification[];
  persist?: boolean;
}

export interface ReevaluationOutcome {
  /** The extraction with the inspector's determinations layered on top. */
  verifiedExtraction: ExtractionResult;
  compliance: ComplianceResult;
  issues: ComplianceIssue[];
  issueSummary: IssueSummary;
  report: ComplianceReport;
  captureCompleteness: number;
  /** Fields the inspector actually ruled on, for the audit record. */
  verifiedFields: string[];
}

function reportId(): string {
  return `RPT-${randomBytes(6).toString('hex').toUpperCase()}`;
}

/**
 * Applies one determination to one extracted field.
 *
 * Returns a new record. The input is never mutated, because the stored scan is
 * the evidence of what the camera read and the report has to be able to show
 * both that and what the inspector concluded.
 */
function applyVerification(
  record: ExtractedFieldRecord,
  verification: FieldVerification,
): ExtractedFieldRecord {
  if (verification.action === 'MARKED_UNAVAILABLE') {
    return {
      ...record,
      value: null,
      status: 'NOT_FOUND',
      // Carried through `toComplianceRequest` below as HUMAN_MARKED_ABSENT.
      verification: 'MARKED_UNAVAILABLE',
    };
  }

  const value =
    verification.action === 'EDITED' ? (verification.value ?? null) : record.value;

  return {
    ...record,
    value,
    status: value === null || value.trim() === '' ? 'NOT_FOUND' : 'FOUND',
    verification: verification.action,
  };
}

/**
 * Layers the inspector's determinations over the scan's extraction.
 *
 * Exported because the caller persists this alongside — not instead of — the
 * original, and the report renders both.
 */
export function applyVerifications(
  extraction: ExtractionResult,
  verifications: FieldVerification[],
): { verified: ExtractionResult; applied: string[] } {
  const byField = new Map(verifications.map((entry) => [entry.field, entry]));
  const applied: string[] = [];

  const fields: Record<string, ExtractedFieldRecord> = {};

  for (const [name, record] of Object.entries(extraction.fields)) {
    const verification = byField.get(name);

    if (!verification) {
      fields[name] = record;
      continue;
    }

    fields[name] = applyVerification(record, verification);
    applied.push(name);
  }

  return { verified: { ...extraction, fields }, applied };
}

/**
 * Runs the Legal Metrology rule engine over the verified values.
 *
 * Everything downstream of the engine — issue generation, the report — is the
 * same code the scan uses, so a report produced here and one produced by a
 * scan are the same artefact with the same provenance fields.
 */
export async function reevaluateWithVerifiedFields(
  input: ReevaluationInput,
): Promise<ReevaluationOutcome> {
  const { verified, applied } = applyVerifications(input.extraction, input.verifications);

  const adapted = toComplianceRequest({
    inspectionId: input.inspectionId,
    inspectionDate: input.inspectionDate,
    productContext: input.productContext,
    extraction: verified,
    ocr: input.ocr,
    imageIds: input.imageIds,
  });

  /**
   * The inspector's determinations are promoted on the engine's own request,
   * after the adapter has built it.
   *
   * Done here rather than inside the adapter because the adapter's job is to
   * translate an *extraction*, and it should not have to know that a human was
   * involved. The statuses below are the engine's contract for exactly this —
   * see `FIELD_EXTRACTION_STATUSES` — and `DecisionEngine` treats them as
   * outranking any model confidence.
   */
  for (const [name, record] of Object.entries(verified.fields)) {
    const field = adapted.request.fields?.[name];
    if (!field || !record.verification) continue;

    if (record.verification === 'MARKED_UNAVAILABLE') {
      field.status = 'HUMAN_MARKED_ABSENT';
      // A person examined the package and the declaration is not on it. This
      // is the only route by which an absence becomes certain, and it is why
      // capture completeness no longer has to carry the decision.
      field.absenceConfidence = 1;
      continue;
    }

    field.status = 'HUMAN_VERIFIED';
    // Confidence is dropped rather than raised to 1: the engine ignores it for
    // a human-supplied value, and leaving a stale OCR score on a corrected
    // reading would misreport where the value came from.
    delete field.confidence;
  }

  const compliance = await evaluateCompliance(adapted.request, {
    persist: input.persist !== false,
  });

  const { issues, summary: issueSummary } = generateIssues(compliance, input.inspectionId);

  const report = buildReport({
    inspectionId: input.inspectionId,
    reportId: reportId(),
    generatedAt: new Date().toISOString(),
    inspectionDate: adapted.request.inspectionDate,
    images: [],
    ocr: input.ocr,
    extraction: verified,
    compliance,
    issues,
    issueSummary,
    captureCompleteness: adapted.captureCompleteness,
    contextApplied: adapted.appliedSignals.map((signal) => ({
      key: signal.key,
      value: signal.value,
      basis: signal.basis,
    })),
    timings: {
      ocrMs: 0,
      extractionMs: 0,
      ruleEngineMs: compliance.durationMs ?? 0,
      totalMs: compliance.durationMs ?? 0,
    },
  });

  logger.info(
    {
      inspectionId: input.inspectionId,
      verifiedFields: applied.length,
      decision: compliance.status,
      ruleSetVersion: compliance.ruleSetVersion,
      issues: issues.length,
    },
    'inspection re-evaluated against inspector-verified values',
  );

  return {
    verifiedExtraction: verified,
    compliance,
    issues,
    issueSummary,
    report,
    captureCompleteness: adapted.captureCompleteness,
    verifiedFields: applied,
  };
}
