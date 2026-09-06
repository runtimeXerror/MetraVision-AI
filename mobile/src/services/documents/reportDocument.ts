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

/**
 * ── THREE WORDS, AND SILENCE ────────────────────────────────────────────────
 *
 * This column said five things: Compliant, Not compliant, Needs review, Not
 * applicable, Not assessed. An officer reading a filed report could not tell
 * the last two apart, and worse, a declaration with a value plainly printed
 * beside it came back "Not applicable" — which reads as nonsense, because the
 * value is right there.
 *
 * It was not nonsense. A rule can be inapplicable to a commodity while the
 * declaration it concerns is still printed on the pack — country of origin on a
 * domestic package, for instance. But a reader is entitled to treat a Result
 * column as a verdict, and there is no verdict in "this rule was never in
 * play". Two labels were being spent saying nothing.
 *
 * So the column says only what a reader can act on:
 *
 *     Compliant       the requirement was met
 *     Not compliant   it was not — this is a finding
 *     Needs review    the engine could not decide, a person must
 *
 * and where none of those is true it says nothing at all. A blank cell in a
 * column of verdicts is not an omission; it is the correct statement that there
 * is no verdict to give.
 */
function resultCell(check?: { result: string }): string {
  switch (check?.result) {
    case 'pass':
      return 'Compliant';
    case 'fail':
      return '<b class="bad">Not compliant</b>';
    case 'warning':
      return '<span class="review">Needs review</span>';
    default:
      return '';
  }
}

/** A value with its superseded original printed underneath, where amended. */
function amendedCell(current: string | null, original: string | null): string {
  // Red, because on a compliance report an absent mandatory declaration is the
  // finding — not a blank to be scanned past. It is the one thing in this table
  // a reader must not miss.
  const shown =
    current === null || current === ''
      ? '<b class="bad">Not declared</b>'
      : esc(current);
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
  sections.push(`<h2>Where and who</h2>
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
  sections.push(`<h2>The product</h2>
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
    /**
     * Each declaration's own rule check.
     *
     * The report used to print two tables: the declarations, and then every
     * rule check the engine ran. A reader wanting to know whether the net
     * quantity was compliant read the value in the first and then hunted for
     * the matching rule in the second — twenty rows, most of them recording
     * that a rule did not apply. The verdict belongs against the declaration
     * it is about.
     */
    const resultByField = new Map<string, (typeof analysis.compliance.checks)[number]>();
    for (const check of analysis.compliance.checks) {
      for (const key of check.relatedFieldKeys) {
        if (!resultByField.has(key)) resultByField.set(key, check);
      }
    }

    const rows = analysis.fields
      .map((field, index) => {
        const recorded = effectiveValue(field);
        const amended = amendment?.fieldValues?.[field.key];
        const value = amended ?? recorded;

        const source = amended
          ? 'Amended by the officer'
          : field.reviewAction === 'edited'
            ? 'Corrected by the officer'
            : field.reviewAction === 'marked_unavailable'
              ? 'Marked absent by the officer'
              : field.reviewAction === 'accepted'
                ? 'Confirmed by the officer'
                : // Read confidence belongs here and only here. It qualifies an
                  // automated reading and says nothing about a value a person
                  // put their name to, so it was misleading as a column of its
                  // own with a figure printed on every row.
                  `Read automatically · ${formatConfidence(field.confidence)}`;

        return `<tr>
          <td class="num faint">${index + 1}</td>
          <td>${esc(field.label)}${field.required ? '<br /><span class="faint">Mandatory</span>' : ''}</td>
          <td>${amendedCell(value, amended ? recorded : null)}</td>
          <td>${resultCell(resultByField.get(field.key))}</td>
          <td class="faint">${source}</td>
        </tr>`;
      })
      .join('');

    sections.push(`<h2>Declarations</h2>
      <table>
        <tr>
          <th class="num">#</th><th>Declaration</th><th>Value of record</th>
          <th>Result</th><th>Source</th>
        </tr>
        ${rows}
      </table>`);

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
                  <div class="cite">Contravenes ${esc(violation.ruleReference.split('\u2014')[0]?.trim() ?? violation.ruleReference)}</div>
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

    /**
     * ── WHAT IS LEFT OF "CHECKS PERFORMED" ──────────────────────────────
     *
     * The table is gone. Sixteen of its twenty rows restated, in rule codes,
     * what the Declarations table above now says against each declaration in
     * plain words; most of the rest recorded that a rule did not apply to this
     * commodity, which is not a finding and does not belong in a document
     * served on a dealer.
     *
     * What is kept is the part that had nowhere else to go: requirements that
     * apply to the package as a whole rather than to any one declaration —
     * principally the type-height and legibility rules of Rule 7 — and only
     * where they were not satisfied. A rule that passed, or did not apply, adds
     * nothing a reader can act on.
     *
     * Nothing adverse is lost by dropping the rest: an unsatisfied requirement
     * is either a numbered finding above or is listed here.
     */
    const packageLevel = analysis.compliance.checks.filter(
      (check) =>
        check.relatedFieldKeys.length === 0 &&
        check.result !== 'pass' &&
        check.result !== 'not_applicable',
    );

    if (packageLevel.length > 0) {
      sections.push(`<h2>Other checks</h2>
        <table>
          <tr><th>Requirement</th><th>Rule</th><th>Result</th></tr>
          ${packageLevel
            .map(
              (check) => `<tr>
                <td>${esc(check.title)}${
                  check.message ? `<br /><span class="faint">${esc(check.message)}</span>` : ''
                }</td>
                <td class="mono">${esc(check.ruleReference)}</td>
                <td>${resultCell(check)}</td>
              </tr>`,
            )
            .join('')}
        </table>`);
    }

    if (analysis.compliance.warnings.length > 0) {
      sections.push(`<h2>Notes</h2>
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
    sections.push(`<h2>Officer notes</h2>
      ${intake ? `<p>${esc(intake)}</p>` : ''}
      ${filing ? `<p>${esc(filing)}</p>` : ''}`);
  }

  /*
   * ── ATTESTATION ────────────────────────────────────────────────────────
   *
   * Two blocks, and they are deliberately not the same kind of thing.
   *
   * The inspecting officer's side is *signed already*. They filed this record
   * from an authenticated session, at a recorded time, and that act is the
   * signature — so it is stated as one, with the badge number and the filing
   * time that make it checkable against the register. Printing a blank rule for
   * them to sign afterwards would ask for a wet signature on the one thing the
   * system can already vouch for.
   *
   * The Controller's side is a blank rule, because the system cannot vouch for
   * it. A countersignature is an act by somebody who has not touched this
   * software, and drawing a line for a pen is the honest representation of
   * that.
   */
  sections.push(`
    <div class="sign">
      <div>
        <div class="signed">
          <div class="mark">Digitally filed</div>
          <div class="who">${esc(inspection.inspectorName)}</div>
          <div class="faint">${esc(inspection.inspectorId)} · Inspecting officer</div>
          <div class="faint">${esc(
            formatDateTime(inspection.finalizedAt ?? inspection.updatedAt),
          )}</div>
          <div class="faint">Record ${esc(inspection.referenceId)}</div>
        </div>
      </div>
      <div>
        <div class="line">
          <span class="faint">Controller / Legal Metrology Officer</span>
        </div>
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

  /*
   * The standing note that used to close every report is gone.
   *
   * "Findings were produced by an automated analysis of the label photographs
   * and reviewed by the inspecting officer. Values the officer confirmed,
   * corrected or amended are marked as such in the declarations table."
   *
   * Both halves were already on the page and better placed. The Source column
   * of the Declarations table says, per declaration, whether it was read
   * automatically or confirmed by the officer — which is the same claim made
   * specifically rather than in general, and made where the reader is looking
   * at the value it qualifies. And the signature block above carries the
   * officer's name and the filing time, which is the actual attestation.
   *
   * A paragraph restating both, under the signature, on every report, is the
   * kind of boilerplate a reader learns to skip — and once they are skipping
   * the last block on the page they are skipping the amendment note beside it,
   * which is not boilerplate at all.
   */

  return sections.join('\n');
}

/** The report as printable HTML — the source for the PDF export. */
export function reportToHtml(report: Report, amendment?: ReportAmendment): string {
  return documentShell(metaFor(report, amendment), reportBody(report, amendment));
}
