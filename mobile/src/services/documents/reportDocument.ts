import {
  complianceStatusLabels,
  imageSideLabels,
  productCategoryLabels,
  severityLabels,
  violationCategoryLabels,
} from '../../constants/labels';
import { effectiveValue } from '../../store/analysisStore';
import type { ReportAmendment } from '../../store/reportDraftStore';
import type { Report } from '../../types';
import { formatConfidence, formatDate, formatDateTime } from '../../utils/format';

import { documentShell, esc, keyValueTable, orDash, type DocumentMeta } from './html';

/**
 * The inspection report as a document.
 *
 * Laid out as an enforcement record rather than as a print of the app: a
 * government letterhead, numbered findings that cite the rule contravened, the
 * evidence examined, and a signature block. This is the artefact served on a
 * dealer and read by a supervisor, so everything the inspector saw on screen
 * has to appear here — including the values the model got wrong.
 *
 * Where the officer has amended a value in the app, both readings are printed:
 * the amendment as the value of record, and the original beneath it. Replacing
 * one with the other would leave a document that cannot be reconciled against
 * the inspection it came from.
 */

function metaFor(report: Report, amendment?: ReportAmendment): DocumentMeta {
  const inspection = report.snapshot;
  const business = amendment?.businessName ?? inspection.details.businessName;

  return {
    title: 'Inspection Report',
    references: [
      { label: 'Report No.', value: report.referenceId },
      { label: 'Inspection No.', value: inspection.referenceId },
    ],
    scope: `Compliance examination of a packaged commodity at ${business}, carried out on ${formatDate(
      inspection.createdAt,
    )} under the Legal Metrology (Packaged Commodities) Rules, 2011.`,
    generatedBy: report.generatedBy,
    generatedAt: report.generatedAt,
  };
}

/** A value with its superseded original printed underneath, where amended. */
function amendedCell(current: string | null, original: string | null): string {
  const shown = current === null || current === '' ? '<span class="muted">Not declared</span>' : esc(current);
  if (original === null || original === current) return shown;

  return `${shown}<div class="amended">Amended by the officer · recorded as ${
    original === null || original === '' ? 'not declared' : esc(original)
  }</div>`;
}

function reportBody(report: Report, amendment?: ReportAmendment): string {
  const inspection = report.snapshot;
  const analysis = inspection.analysis;
  const details = inspection.details;

  const sections: string[] = [];

  /* Verdict */
  if (analysis) {
    sections.push(`
      <div class="verdict">
        <div>
          <div class="label">Determination</div>
          <div class="status">${esc(complianceStatusLabels[analysis.compliance.status])}</div>
          <div class="muted" style="margin-top:3px">Assessed under ${esc(
            analysis.compliance.ruleSetLabel,
          )}</div>
        </div>
        <div style="text-align:right">
          <div class="label">Compliance score</div>
          <div class="score">${analysis.compliance.score}%</div>
        </div>
      </div>`);
  } else {
    sections.push(
      `<div class="note">This inspection was filed without a completed analysis. No determination is recorded against it.</div>`,
    );
  }

  /* Premises */
  sections.push(`<h2>Premises and officer</h2>
    <table class="kv">
      <tr><td>Business / shop</td><td>${amendedCell(
        amendment?.businessName ?? details.businessName,
        amendment?.businessName ? details.businessName : null,
      )}</td></tr>
      <tr><td>Location</td><td>${amendedCell(
        amendment?.location ?? details.location,
        amendment?.location ? details.location : null,
      )}</td></tr>
      <tr><td>District</td><td>${amendedCell(
        amendment?.district ?? details.district ?? null,
        amendment?.district ? (details.district ?? null) : null,
      )}</td></tr>
      <tr><td>State</td><td>${amendedCell(
        amendment?.state ?? details.state ?? null,
        amendment?.state ? (details.state ?? null) : null,
      )}</td></tr>
      <tr><td>GPS fix</td><td>${orDash(
        details.latitude !== undefined && details.longitude !== undefined
          ? `${details.latitude.toFixed(5)}, ${details.longitude.toFixed(5)}${
              details.accuracyM ? ` (±${Math.round(details.accuracyM)} m)` : ''
            }`
          : null,
      )}</td></tr>
      <tr><td>Inspected on</td><td>${esc(formatDateTime(inspection.createdAt))}</td></tr>
      <tr><td>Inspecting officer</td><td>${esc(inspection.inspectorName)} (${esc(
        inspection.inspectorId,
      )})</td></tr>
    </table>`);

  /* Commodity */
  const category = amendment?.productCategory ?? details.productCategory ?? analysis?.category ?? 'other';
  sections.push(`<h2>Commodity examined</h2>
    <table class="kv">
      <tr><td>Category</td><td>${amendedCell(
        productCategoryLabels[category],
        amendment?.productCategory && details.productCategory
          ? productCategoryLabels[details.productCategory]
          : null,
      )}</td></tr>
      <tr><td>Product</td><td>${amendedCell(
        amendment?.productName ?? details.productName ?? null,
        amendment?.productName ? (details.productName ?? null) : null,
      )}</td></tr>
      <tr><td>Origin</td><td>${orDash(
        analysis ? (analysis.origin === 'imported' ? 'Imported' : 'Domestic') : null,
      )}</td></tr>
      <tr><td>Rule set applied</td><td>${orDash(analysis?.compliance.ruleSetLabel)}</td></tr>
    </table>`);

  /* Declarations */
  if (analysis) {
    const rows = analysis.fields
      .map((field) => {
        const recorded = effectiveValue(field);
        const amended = amendment?.fieldValues?.[field.key];
        const value = amended ?? recorded;

        const provenance = amended
          ? 'Amended at issue'
          : field.reviewAction === 'edited'
            ? 'Corrected by inspector'
            : field.reviewAction === 'marked_unavailable'
              ? 'Marked absent by inspector'
              : field.reviewAction === 'accepted'
                ? 'Confirmed by inspector'
                : 'Not reviewed';

        return `<tr>
          <td>${esc(field.label)}${field.required ? '<br /><span class="faint">Mandatory</span>' : ''}</td>
          <td>${amendedCell(value, amended ? recorded : null)}</td>
          <td class="num">${esc(formatConfidence(field.confidence))}</td>
          <td class="faint">${provenance}</td>
        </tr>`;
      })
      .join('');

    sections.push(`<h2>Declarations examined</h2>
      <table>
        <tr><th>Declaration</th><th>Value of record</th><th class="num">Read conf.</th><th>Provenance</th></tr>
        ${rows}
      </table>
      <p class="faint" style="margin-top:6px">
        Read confidence is the confidence of the automated extraction, not of the determination.
        Where the officer confirmed, corrected or amended a value, the value of record is theirs.
      </p>`);

    /* Findings */
    const violations = analysis.compliance.violations;
    sections.push(`<h2>Findings (${violations.length})</h2>
      ${
        violations.length === 0
          ? `<p class="muted">No contravention was observed on the declarations examined.</p>`
          : violations
              .map(
                (violation, index) => `<div class="finding">
                  <div class="head">
                    <span class="title">${index + 1}. ${esc(violation.title)}</span>
                    <span class="tag${violation.severity === 'critical' ? ' solid' : ''}">${esc(
                      severityLabels[violation.severity],
                    )}</span>
                  </div>
                  <div class="muted">${esc(violation.description)}</div>
                  <div style="margin-top:4px">
                    <span class="faint">Required:</span> ${orDash(violation.expected)}
                    &nbsp;&nbsp;<span class="faint">Observed:</span> ${
                      violation.observed ? esc(violation.observed) : 'Not declared'
                    }
                  </div>
                  <div class="cite">Contravenes ${esc(violation.ruleReference)} · ${esc(
                    violationCategoryLabels[violation.category],
                  )} · ${esc(violation.code)}</div>
                  ${
                    violation.recommendation
                      ? `<div class="muted" style="margin-top:4px"><span class="faint">Action:</span> ${esc(
                          violation.recommendation,
                        )}</div>`
                      : ''
                  }
                </div>`,
              )
              .join('')
      }`);

    /* Checks — the audit trail behind the verdict. */
    if (analysis.compliance.checks.length > 0) {
      sections.push(`<h2>Checks performed (${analysis.compliance.checks.length})</h2>
        <table>
          <tr><th>Rule</th><th>Check</th><th>Result</th><th>Observed</th></tr>
          ${analysis.compliance.checks
            .map(
              (check) => `<tr>
                <td class="mono">${esc(check.ruleReference)}</td>
                <td>${esc(check.title)}</td>
                <td>${esc(check.result.replace('_', ' '))}</td>
                <td>${check.observed ? esc(check.observed) : '<span class="muted">Not declared</span>'}</td>
              </tr>`,
            )
            .join('')}
        </table>`);
    }

    if (analysis.compliance.warnings.length > 0) {
      sections.push(`<h2>Advisories</h2>
        <ul style="margin:0;padding-left:15px">
          ${analysis.compliance.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}
        </ul>`);
    }
  }

  /* Evidence */
  sections.push(`<h2>Evidence (${inspection.images.length})</h2>
    ${
      inspection.images.length === 0
        ? `<p class="muted">No photographs are attached to this record.</p>`
        : `<div class="evidence">${inspection.images
            .map(
              (image, index) => `<figure>
                <img src="${esc(image.uri)}" alt="Evidence ${index + 1}" />
                <figcaption>${index + 1}. ${esc(imageSideLabels[image.side])} · ${esc(
                  formatDateTime(image.capturedAt),
                )}</figcaption>
              </figure>`,
            )
            .join('')}</div>`
    }`);

  /* Remarks */
  const intake = amendment?.inspectorNotes ?? details.inspectorNotes;
  const filing = amendment?.finalNotes ?? inspection.finalNotes;
  if (intake || filing) {
    sections.push(`<h2>Remarks of the inspecting officer</h2>
      ${intake ? `<p>${esc(intake)}</p>` : ''}
      ${filing ? `<p>${esc(filing)}</p>` : ''}`);
  }

  /* Attestation */
  sections.push(`
    <div class="sign">
      <div>
        <div class="line">
          ${esc(inspection.inspectorName)} · ${esc(inspection.inspectorId)}<br />
          <span class="faint">Inspecting officer · filed ${esc(
            formatDateTime(inspection.finalizedAt ?? inspection.updatedAt),
          )}</span>
        </div>
      </div>
      <div>
        <div class="line"><span class="faint">Controller / Legal Metrology Officer</span></div>
      </div>
    </div>`);

  if (amendment) {
    sections.push(`<div class="note">
      <b>Amended at issue.</b> ${esc(amendment.amendedBy)} amended this report on ${esc(
        formatDateTime(amendment.amendedAt),
      )}. Amended entries are marked above and the value originally recorded is printed beneath each
      one. The stored inspection record is unchanged.
      ${amendment.amendmentNote ? `<br /><br />${esc(amendment.amendmentNote)}` : ''}
    </div>`);
  }

  sections.push(`<div class="note">
    Findings were produced by an automated analysis of the label photographs and reviewed by the
    inspecting officer. Values the officer confirmed, corrected or amended are marked as such in the
    declarations table.
  </div>`);

  return sections.join('\n');
}

/** The report as printable HTML — the source for the PDF export. */
export function reportToHtml(report: Report, amendment?: ReportAmendment): string {
  return documentShell(metaFor(report, amendment), reportBody(report, amendment));
}
