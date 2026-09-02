import {
  complianceStatusLabels,
  productCategoryLabels,
  severityLabels,
  violationCategoryLabels,
} from '../../constants/labels';
import { colors } from '../../constants/theme';
import type { DashboardOverview, Inspector } from '../../types';
import { formatDate } from '../../utils/format';
import { bucketCaption, bucketTrend } from '../../utils/trend';

import { barListBlock, documentShell, esc, shareBlock, type DocumentMeta, type SharePart } from './html';

/**
 * The compliance and enforcement dashboard as a document.
 *
 * This is the return an officer sends upward, so it states its own scope in the
 * first line: what window it covers, whose work it counts, and when it was
 * drawn. A summary that omits any of the three cannot be checked later against
 * the records it was drawn from.
 */

/**
 * The segment order is load-bearing and matches the on-screen chart.
 *
 * "Violation" red and "review required" amber are only ΔE 10 apart to a
 * normal-sighted reader — too close for two touching segments. Seating the
 * green between them lifts the worst adjacent pair to ΔE 20. Every segment also
 * carries its label and count in the table beside the bar, which is what makes
 * the block readable when it is printed in greyscale.
 */
function shareParts(overview: DashboardOverview): SharePart[] {
  const at = (status: string) =>
    overview.distribution.find((slice) => slice.status === status)?.count ?? 0;

  return [
    { label: complianceStatusLabels.violation, value: at('violation'), color: colors.danger },
    { label: complianceStatusLabels.compliant, value: at('compliant'), color: colors.success },
    {
      label: complianceStatusLabels.review_required,
      value: at('review_required'),
      color: colors.warning,
    },
    { label: 'Not yet assessed', value: at('not_assessed'), color: colors.neutral },
  ];
}

function metaFor(overview: DashboardOverview, inspector?: Inspector | null): DocumentMeta {
  const { period } = overview;
  return {
    title: 'Compliance & Enforcement Summary',
    references: [{ label: 'Summary No.', value: `SUM-${period.to.slice(0, 10)}` }],
    scope:
      `Covering ${formatDate(period.from)} to ${formatDate(period.to)} (${period.days} days), ` +
      `over ${overview.summary.totalInspections} inspection${
        overview.summary.totalInspections === 1 ? '' : 's'
      } within the scope of ${inspector?.name ?? 'the signed-in officer'}` +
      `${inspector?.zone ? `, ${inspector.zone}` : ''}.`,
    generatedBy: inspector ? `${inspector.name} (${inspector.employeeId})` : 'Legal Metrology',
    generatedAt: overview.generatedAt,
  };
}

function kpiBlock(overview: DashboardOverview): string {
  const s = overview.summary;
  const tiles: Array<[string, string | number]> = [
    ['Inspections', s.totalInspections],
    ['Compliance rate', `${s.complianceRate}%`],
    ['Violations', s.violations],
    ['Pending review', s.pendingReviews],
    ['Findings raised', s.totalViolationFindings],
    ['Finalized', s.finalized],
    ['Active officers', s.activeInspectors],
  ];

  return `<div class="kpis">${tiles
    .map(([label, value]) => `<div class="kpi"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div></div>`)
    .join('')}</div>`;
}

function trendBlock(overview: DashboardOverview): string {
  const buckets = bucketTrend(overview.trend, 20);
  const max = buckets.reduce((peak, bucket) => Math.max(peak, bucket.total), 0);

  if (buckets.length === 0 || max === 0) {
    return `<p class="faint">No inspections were recorded in this period.</p>`;
  }

  const columns = buckets
    .map((bucket) => {
      const full = bucket.total > 0 ? Math.max((bucket.total / max) * 92, 3) : 0;
      const violations = bucket.total > 0 ? (bucket.violations / bucket.total) * full : 0;
      const clear = Math.max(full - violations, 0);
      const stacked = violations > 0 && clear > 0;

      return `<div>
        ${
          clear > 0
            ? `<b style="height:${stacked ? Math.max(clear - 2, 1) : clear}px;margin-bottom:${
                stacked ? 2 : 0
              }px;background:${colors.navySoft};border-top-left-radius:4px;border-top-right-radius:4px"></b>`
            : ''
        }
        ${
          violations > 0
            ? `<b style="height:${violations}px;background:${colors.danger};border-top-left-radius:${
                clear > 0 ? 0 : 4
              }px;border-top-right-radius:${clear > 0 ? 0 : 4}px"></b>`
            : ''
        }
      </div>`;
    })
    .join('');

  const first = buckets[0]!;
  const middle = buckets[Math.floor((buckets.length - 1) / 2)]!;
  const last = buckets[buckets.length - 1]!;

  return `
    <div style="display:flex;justify-content:space-between;margin-bottom:5px">
      <span class="faint" style="font-size:8px;letter-spacing:0.6px;text-transform:uppercase">${esc(
        bucketCaption(overview.trend, buckets),
      )}</span>
      <span class="muted">Peak ${max}</span>
    </div>
    <div class="cols">${columns}</div>
    <div class="axis">
      <span class="faint">${esc(first.label)}</span>
      ${buckets.length > 2 ? `<span class="faint">${esc(middle.label)}</span>` : ''}
      <span class="faint">${esc(last.label)}</span>
    </div>
    <div class="keys">
      <span><i style="background:${colors.navySoft}"></i>No violation found</span>
      <span><i style="background:${colors.danger}"></i>Violation found</span>
    </div>`;
}

function dashboardBody(overview: DashboardOverview, inspector?: Inspector | null): string {
  const sections: string[] = [];

  sections.push(`<h2>Position at a glance</h2>${kpiBlock(overview)}`);

  sections.push(`<h2>Compliance status</h2>${shareBlock(shareParts(overview))}
    <p class="faint" style="margin-top:6px">
      The compliance rate is calculated over assessed records only. Records still awaiting
      analysis are shown as "not yet assessed" and are excluded from the rate, so opening a
      draft cannot move it.
    </p>`);

  sections.push(`<h2>Enforcement activity over the period</h2>${trendBlock(overview)}`);

  sections.push(`<h2>Most frequent findings</h2>
    ${barListBlock(
      overview.violationTypes.map((type) => ({
        label: type.title,
        sublabel: `${violationCategoryLabels[type.category]} · ${severityLabels[type.severity]} · ${type.code}`,
        value: type.count,
      })),
      'No findings were raised in this period.',
    )}`);

  sections.push(`<h2>By product category</h2>
    ${
      overview.violationsByCategory.length === 0
        ? `<p class="faint">No inspections were recorded in this period.</p>`
        : `<table>
            <tr><th>Category</th><th class="num">Inspections</th><th class="num">Findings</th><th class="num">Findings / inspection</th></tr>
            ${overview.violationsByCategory
              .map(
                (row) => `<tr>
                  <td>${esc(productCategoryLabels[row.category])}</td>
                  <td class="num">${row.inspections}</td>
                  <td class="num">${row.violations}</td>
                  <td class="num">${
                    row.inspections > 0 ? (row.violations / row.inspections).toFixed(2) : '—'
                  }</td>
                </tr>`,
              )
              .join('')}
          </table>`
    }`);

  const active = overview.inspectorActivity.filter((row) => row.totalInspections > 0);
  sections.push(`<h2>Officer activity</h2>
    ${
      active.length === 0
        ? `<p class="faint">No officer filed an inspection in this period.</p>`
        : `<table>
            <tr>
              <th>Officer</th><th class="num">Filed</th><th class="num">Compliant</th>
              <th class="num">Violations</th><th class="num">Pending</th><th class="num">Rate</th><th>Last activity</th>
            </tr>
            ${active
              .map(
                (row) => `<tr>
                  <td>${esc(row.name)}<br /><span class="faint mono">${esc(row.employeeId)}${
                    row.district ? ` · ${esc(row.district)}` : ''
                  }</span></td>
                  <td class="num">${row.totalInspections}</td>
                  <td class="num">${row.compliant}</td>
                  <td class="num">${row.violations}</td>
                  <td class="num">${row.pendingReviews}</td>
                  <td class="num">${row.complianceRate}%</td>
                  <td>${esc(formatDate(row.lastActivityAt))}</td>
                </tr>`,
              )
              .join('')}
          </table>`
    }`);

  if (overview.districts.length > 0) {
    sections.push(`<h2>By district</h2>
      <table>
        <tr>
          <th>District</th><th>State</th><th class="num">Inspections</th>
          <th class="num">Findings</th><th class="num">Assessed</th><th class="num">Rate</th>
        </tr>
        ${overview.districts
          .map(
            (row) => `<tr>
              <td>${esc(row.district)}</td>
              <td>${esc(row.state ?? '—')}</td>
              <td class="num">${row.inspections}</td>
              <td class="num">${row.violations}</td>
              <td class="num">${row.assessed}</td>
              <td class="num">${row.complianceRate}%</td>
            </tr>`,
          )
          .join('')}
      </table>`);
  }

  sections.push(`
    <div class="sign">
      <div>
        <div class="rule">
          ${esc(inspector?.name ?? 'Reporting officer')}${
            inspector ? ` · ${esc(inspector.employeeId)}` : ''
          }<br />
          <span class="faint">Reporting officer</span>
        </div>
      </div>
      <div>
        <div class="rule"><span class="faint">Controller of Legal Metrology</span></div>
      </div>
    </div>

    <div class="note">
      Figures are aggregated from inspection records filed in this system and are scoped to the
      signing officer's own remit. Compliance determinations were produced by an automated
      analysis of label photographs and reviewed by the filing officer.
    </div>`);

  return sections.join('\n');
}

/** The dashboard as printable HTML — the source for the PDF export. */
export function dashboardToHtml(
  overview: DashboardOverview,
  inspector?: Inspector | null,
): string {
  return documentShell(metaFor(overview, inspector), dashboardBody(overview, inspector));
}
