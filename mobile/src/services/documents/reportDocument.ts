import {
  complianceStatusLabels,
  complianceStatusTones,
  imageSideLabels,
  productCategoryLabels,
  severityLabels,
  violationCategoryLabels,
} from '../../constants/labels';
import { effectiveValue } from '../../store/analysisStore';
import type { ReportAmendment } from '../../store/reportDraftStore';
import type { ComplianceStatus, Report } from '../../types';
import { formatDate, formatDateTime } from '../../utils/format';

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
 * ── TWO WORDS, AND SILENCE ──────────────────────────────────────────────────
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
 * play". Labels were being spent saying nothing.
 *
 * So the column says only what a reader can act on:
 *
 *     Compliant       the requirement was met
 *     Not compliant   it was not — this is a finding
 *
 * and where neither is true it says nothing at all. A blank cell in a column
 * of verdicts is not an omission; it is the correct statement that there is no
 * verdict to give.
 */
function resultCell(check?: { result: string }): string {
  switch (check?.result) {
    case 'pass':
      return '<span class="ok">Compliant</span>';
    case 'fail':
      return '<b class="bad">Not compliant</b>';
    default:
      return '';
  }
}

/**
 * Which tone the determination block wears.
 *
 * Read off `complianceStatusTones`, the same map the screens colour their
 * badges from, so the PDF an officer files and the screen they showed a dealer
 * cannot disagree about what colour a determination is.
 */
const VERDICT_CLASS: Record<string, string> = {
  success: 'ok',
  danger: 'bad',
};

function verdictTone(status: ComplianceStatus): string {
  return VERDICT_CLASS[complianceStatusTones[status]] ?? '';
}

/**
 * The three counts, as a band under the determination.
 *
 * Printed before the schedule rather than inside it, because the first
 * question a reader has is how many findings there are, and the answer was
 * previously a sentence in the middle of the page five sections down.
 */
function snapshotBand(tally: { pass: number; fail: number; notApplicable: number }): string {
  const tiles: Array<[string, string, number]> = [
    ['ok', 'Compliant', tally.pass],
    ['bad', 'Not compliant', tally.fail],
    ['na', 'Not applicable', tally.notApplicable],
  ];
  return `<div class="snap">${tiles
    .map(
      ([tone, label, count]) =>
        `<div class="${tone}"><div class="k">${esc(label)}</div><div class="v">${count}</div></div>`,
    )
    .join('')}</div>`;
}

/**
 * `2026.09.06 07:45:12 +05:30` — the form a digital signature certificate
 * stamps onto a PDF, which is what this block is imitating.
 *
 * Dots rather than slashes, seconds rather than minutes, and the offset spelled
 * out. The precision is the point: a signature time that cannot be compared
 * against a server log to the second is not much of an attestation.
 */
function signatureStamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '—';

  const pad = (n: number) => String(n).padStart(2, '0');

  const offsetMinutes = -at.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(
    Math.abs(offsetMinutes) % 60,
  )}`;

  return (
    `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())} ${offset}`
  );
}

/**
 * `6(1)(e)` out of `6(1)(e) — Retail sale price, as amended by G.S.R. 779(E)`.
 *
 * The long form is the citation the schedule printed; in a column beside the
 * declaration it would wrap to three lines and push the value off the page.
 * The provision number is the part a reader looks up.
 */
function shortRule(reference: string): string {
  return reference.split('—')[0]?.trim() ?? reference;
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
    const checks = analysis.compliance.checks;
    const tally = {
      pass: checks.filter((check) => check.result === 'pass').length,
      fail: checks.filter((check) => check.result === 'fail').length,
      notApplicable: checks.filter((check) => check.result === 'not_applicable').length,
    };

    sections.push(`
      <div class="verdict ${verdictTone(analysis.compliance.status)}">
        <div>
          <div class="label">Determination</div>
          <div class="status">${esc(complianceStatusLabels[analysis.compliance.status])}</div>
          <div class="muted" style="margin-top:3px">Assessed under ${esc(
            analysis.compliance.ruleSetLabel,
          )}</div>
        </div>
      </div>
      ${checks.length > 0 ? snapshotBand(tally) : ''}`);
  } else {
    sections.push(
      `<div class="note">This inspection was filed without a completed analysis. No determination is recorded against it.</div>`,
    );
  }

  /* Premises */
  sections.push(`<h2>Premises and inspecting officer</h2>
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
      <!-- Not run through amendedCell: the amendment form covers the address,
           the district and the state, and a PIN nobody can amend must not be
           drawn as though it had been. -->
      <tr><td>PIN code</td><td>${orDash(details.pincode ?? null)}</td></tr>
      <!-- The GPS fix is not printed.

           It is still on the record — the coordinate and its accuracy are
           stored with the inspection and remain available to anyone auditing
           it. What it is not is something a reader of this document can use:
           the premises is identified by its address, and a decimal pair
           beneath that address is either the same information in a form nobody
           reads, or an em dash on every report filed without a fix. -->
      <tr><td>Inspected on</td><td>${esc(formatDateTime(inspection.createdAt))}</td></tr>
      <tr><td>Inspecting officer</td><td>${esc(inspection.inspectorName)}</td></tr>
    </table>`);

  /* Commodity */
  const category = amendment?.productCategory ?? details.productCategory ?? analysis?.category ?? 'other';
  sections.push(`<h2>About the product</h2>
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

    /**
     * The provisions each declaration answers to, printed beside it.
     *
     * A reader looking at "Net quantity · 30 g · Compliant" has no way to tell
     * which rule made that judgement, and the schedule that used to carry the
     * answer has been taken out of the document — it restated these same rows
     * in rule codes and ran to twenty entries, most of them recording that a
     * provision did not reach the package at all.
     *
     * Rules that did not apply are left out on purpose. "Which rules does this
     * declaration follow" is not answered by a provision that never reached
     * it, and listing those is what made the schedule unreadable.
     *
     * A declaration with nothing here is informational — a brand or a batch
     * code carries no mandatory provision of its own — and prints a dash
     * rather than a blank, so an empty cell is never read as an omission.
     */
    const rulesByField = new Map<string, string[]>();
    for (const check of analysis.compliance.checks) {
      if (check.result === 'not_applicable') continue;
      const reference = shortRule(check.ruleReference);
      if (reference === '') continue;
      for (const key of check.relatedFieldKeys) {
        const found = rulesByField.get(key) ?? [];
        if (!found.includes(reference)) found.push(reference);
        rulesByField.set(key, found);
      }
    }
    const ruleCell = (key: string): string =>
      orDash(rulesByField.get(key)?.join(', ') ?? null);

    /*
     * ── SIXTEEN ROWS, TEN OF THEM SAYING NOTHING ────────────────────────
     *
     * A filed report listed every field the extractor knows about, so a talcum
     * powder carried rows for Dimensions, Vegetarian mark, Genetically modified
     * declaration, Importer, Packer, Expiry date and FSSAI licence — each one
     * "Not declared", each one with no result beside it, because no rule asked
     * about them for this commodity.
     *
     * Ten rows of nothing is not thoroughness. It buries the six that matter,
     * and on a document served on a dealer a column of "Not declared" reads as
     * an accusation about declarations the package was never required to carry.
     *
     * A row earns its place if the rule engine had something to say about it,
     * or the package carries a value for it, or it is mandatory for this
     * commodity — which is exactly the set an officer is checking.
     */
    const listed = analysis.fields.filter((field) => {
      if (effectiveValue(field) !== null) return true;
      if (amendment?.fieldValues?.[field.key]) return true;
      if (field.required) return true;

      /*
       * A rule that did not apply is not a reason to print a row.
       *
       * The test used to be `resultByField.has(field.key)`, which is satisfied
       * by a check the engine recorded as NOT_APPLICABLE — and those are
       * exactly the ones with nothing to say. A cosmetic carried rows for
       * Dimensions, the vegetarian mark and the genetically-modified
       * declaration on that basis: each printed "Not declared" against a blank
       * Result, because the engine's answer for all three was that no rule of
       * this set asks a cosmetic for them.
       *
       * On a document served on a dealer that reads as three accusations. The
       * scan no longer records those declarations at all, but a report is
       * issued from a stored inspection, and the ones already filed still
       * carry them.
       */
      const check = resultByField.get(field.key);
      return check !== undefined && check.result !== 'not_applicable';
    });

    /**
     * ── WHAT WAS READ, AND THEN WHAT WAS NOT ────────────────────────────
     *
     * One table mixed them: a value, then "Not declared", then another value,
     * in whatever order the extractor happened to fill its record. An officer
     * reading it had to go down the column picking out which was which, and
     * the two are not the same kind of thing at all. The first is the evidence
     * — what this package says about itself. The second is the case, if there
     * is one.
     *
     * So they are separated, and the evidence leads. A dealer served with this
     * sees first what the inspector read off their packet, and then, under a
     * heading that says so, the declarations that were looked for and not
     * found.
     */
    const valueOf = (field: (typeof analysis.fields)[number]): string | null =>
      amendment?.fieldValues?.[field.key] ?? effectiveValue(field);

    const declared = listed.filter((field) => valueOf(field) !== null);
    const missing = listed.filter((field) => valueOf(field) === null);

    /*
     * No "Source" column.
     *
     * Each row used to end with where its value came from — "Read
     * automatically · 87%", "Confirmed by the officer" — and the read
     * confidence was the part that got noticed. A percentage beside a legal
     * declaration reads as a score against the dealer, which it is not; it
     * qualifies the camera. Officer amendments still print in the value cell,
     * under the value they replaced, which is where a reader looks for them,
     * and the signature block carries the officer's attestation.
     */
    const declaredRows = declared
      .map((field, index) => {
        const recorded = effectiveValue(field);
        const amended = amendment?.fieldValues?.[field.key];

        return `<tr>
          <td class="num faint">${index + 1}</td>
          <td>${esc(field.label)}</td>
          <td>${amendedCell(amended ?? recorded, amended ? recorded : null)}</td>
          <td class="mono rule">${ruleCell(field.key)}</td>
          <td>${resultCell(resultByField.get(field.key))}</td>
        </tr>`;
      })
      .join('');

    sections.push(`<h2>Declarations read from the package (${declared.length})</h2>
      ${
        declared.length === 0
          ? `<p class="muted">No declaration could be read from the photographs supplied.</p>`
          : `<table>
              <tr>
                <th class="num">#</th><th>Declaration</th><th>Value of record</th>
                <th>Rule</th><th>Result</th>
              </tr>
              ${declaredRows}
            </table>`
      }`);

    if (missing.length > 0) {
      const missingRows = missing
        .map(
          (field, index) => `<tr>
            <td class="num faint">${index + 1}</td>
            <td>${esc(field.label)}</td>
            <td class="mono rule">${ruleCell(field.key)}</td>
            <td>${resultCell(resultByField.get(field.key))}</td>
          </tr>`,
        )
        .join('');

      sections.push(`<h2>Not declared (${missing.length})</h2>
        <p class="muted">
          Looked for on the package and not found. A declaration listed here is missing from the
          photographs examined, which is not the same as being absent from the packet — check the
          faces that were not photographed before acting on any of them.
        </p>
        <table>
          <tr>
            <th class="num">#</th><th>Declaration</th><th>Rule</th><th>Result</th>
          </tr>
          ${missingRows}
        </table>`);
    }

    /*
     * "Issues identified", not "Findings".
     *
     * A finding is what an auditor calls anything they noticed, including the
     * things that were fine — so a reader who is not an auditor cannot tell
     * from the heading whether this section is good news or bad. Everything
     * listed here contravenes a rule, and the heading should say so in the
     * words the dealer receiving the report already uses.
     */
    const violations = analysis.compliance.violations;
    sections.push(`<h2>Issues identified (${violations.length})</h2>
      ${
        violations.length === 0
          ? `<p class="muted">No issue was found in the declarations examined.</p>`
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

    /*
     * ── THE COMPLIANCE SCHEDULE IS GONE ───────────────────────
     *
     * It listed every check the engine ran — twenty rows on a typical
     * cosmetic, and twelve of those recorded only that a provision did not
     * reach the package. A reader looking for what was actually examined had
     * to sort the six that mattered out of the rest, and the rows that did
     * matter restated the declarations table above in rule codes.
     *
     * The part worth keeping was the citation, so that moved: every
     * declaration now prints the provisions it answers to in its own Rule
     * column. The counts a reader needs are in the snapshot on page one.
     *
     * What is deliberately lost is the record of provisions that did not
     * apply. That was the argument for printing the schedule in full — a
     * dealer's interest in knowing a rule was considered and set aside — and
     * it is a real one, but it does not earn a page and a half of a document
     * that is served on them. The evaluation is kept on the inspection record
     * either way, and the console shows it in full.
     */

    /*
     * ── THE NOTES BLOCK IS GONE ─────────────────────────────────────────
     *
     * It printed `compliance.warnings` as a bulleted list at the foot of the
     * report, and by the time the compliance schedule above was complete there
     * was nothing left in it that the reader had not already been told.
     *
     * The Rule 7 note is the clearest case. "A photograph cannot give a
     * measurement in millimetres — check it against the packet with a rule" is
     * exactly what the schedule prints under rules 7(2) and 7(3), against the
     * requirements it qualifies. In the notes it appeared a second time, and
     * on a report with two such checks it appeared twice more, word for word,
     * detached from anything.
     *
     * A qualification belongs against the thing it qualifies. That is the same
     * reasoning that moved read confidence into the Source column and took the
     * standing attestation paragraph off the end of the document.
     */
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
        <div class="slot"></div>
        <div class="line">Controller / Legal Metrology Officer</div>
      </div>
      <div>
        <div class="dsc">
          <div class="by">Digitally signed by</div>
          <div class="name">${esc(inspection.inspectorName)}</div>
          <div>${esc(inspection.inspectorId)}</div>
          <div>Date: ${esc(signatureStamp(inspection.finalizedAt ?? inspection.updatedAt))}</div>
        </div>
        <div class="line">Inspecting Officer · Record ${esc(inspection.referenceId)}</div>
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
   * Both halves were already on the page and better placed. An amended value
   * prints its original beneath it in the Declarations table, where the reader
   * is looking at the value it qualifies. And the signature block above
   * carries the officer's name and the filing time, which is the actual
   * attestation.
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
