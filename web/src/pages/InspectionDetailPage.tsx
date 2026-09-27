import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Download,
  FileBarChart,
  FlaskConical,
  Images,
  MapPin,
  MessageSquare,
  PencilLine,
  ScrollText,
  ShieldAlert,
  Timer,
  UserRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { EvidenceGallery, type EvidenceMark } from '@/components/domain/EvidencePanel';
import { LegalPanel } from '@/components/domain/LegalPanel';
import {
  ComplianceBadge,
  SeverityBadge,
  StatusBadge,
} from '@/components/domain/badges';
import { Input, Textarea } from '@/components/ui/forms';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfidenceBar,
  DetailRow,
  Divider,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { inspectionService, reportService } from '@/services';
import { useIsSupervisor } from '@/store/authStore';
import type { ExtractedField, Inspection, Violation } from '@/types/api';
import { cn } from '@/utils/cn';
import { categoryLabel, formatDateTime, humanise } from '@/utils/format';

/**
 * The inspection record.
 *
 * This is the page an enforcement decision is actually made on, so it is built
 * around one principle: everything shown must be traceable to what was captured.
 * The AI reading, the inspector's correction and the rule that was applied are
 * each shown as separate, labelled facts — never merged into a single
 * authoritative-looking value.
 */

type Tab = 'overview' | 'evidence' | 'analysis' | 'compliance' | 'review' | 'report';

const TABS: Array<{ id: Tab; label: string; icon: typeof ClipboardCheck }> = [
  { id: 'overview', label: 'Overview', icon: ClipboardCheck },
  { id: 'evidence', label: 'Images', icon: Images },
  { id: 'analysis', label: 'AI Analysis', icon: Bot },
  { id: 'compliance', label: 'Compliance', icon: ShieldAlert },
  { id: 'review', label: 'Review', icon: UserRound },
  { id: 'report', label: 'Report', icon: FileBarChart },
];

export function InspectionDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'overview';

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['inspection', id],
    queryFn: () => inspectionService.getInspection(id),
    enabled: Boolean(id),
  });

  function setTab(next: Tab) {
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous);
        if (next === 'overview') search.delete('tab');
        else search.set('tab', next);
        return search;
      },
      { replace: true },
    );
  }

  if (isPending) return <DetailSkeleton />;

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to="/inspections"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-brand"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            All inspections
          </Link>
        }
        title={data.business.name}
        description={`${data.inspectionId} · ${categoryLabel(data.productCategory)}`}
        actions={
          <div className="flex items-center gap-2">
            {data.complianceResult ? (
              <ComplianceBadge status={data.complianceResult.status} />
            ) : null}
            <StatusBadge status={data.status} />
          </div>
        }
      />

      {/* Tabs */}
      {/* Bled to the gutter on a phone, so a half-cut tab shows there is more
          to scroll to rather than ending flush against the padding. */}
      <div className="scroll-slim -mx-3 mb-5 flex gap-0.5 overflow-x-auto border-b border-line px-3 sm:mx-0 sm:px-0">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          const count =
            entry.id === 'compliance'
              ? data.complianceResult?.violations.length
              : entry.id === 'review'
                ? data.review?.pendingFieldCount
                : entry.id === 'evidence'
                  ? data.images.length
                  : undefined;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active ? 'text-brand' : 'text-ink-muted hover:text-ink',
              )}
            >
              <entry.icon className="h-4 w-4" strokeWidth={2} aria-hidden />
              {entry.label}
              {count ? (
                <span className="rounded-full bg-surface-sunken px-1.5 text-2xs font-semibold tabular text-ink-muted">
                  {count}
                </span>
              ) : null}
              <span
                className={cn(
                  'absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand transition-opacity',
                  active ? 'opacity-100' : 'opacity-0',
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {tab === 'overview' ? <OverviewTab inspection={data} /> : null}
      {tab === 'evidence' ? <EvidenceTab inspection={data} /> : null}
      {tab === 'analysis' ? <AnalysisTab inspection={data} /> : null}
      {tab === 'compliance' ? <ComplianceTab inspection={data} /> : null}
      {tab === 'review' ? <ReviewTab inspection={data} /> : null}
      {tab === 'report' ? <ReportTab inspection={data} /> : null}
    </>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function OverviewTab({ inspection }: { inspection: Inspection }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader icon={Building2} title="Inspection information" />
        <CardBody className="py-1">
          <dl>
            <DetailRow label="Reference" mono>
              {inspection.inspectionId}
            </DetailRow>
            <DetailRow label="Business">{inspection.business.name}</DetailRow>
            {inspection.business.ownerName ? (
              <DetailRow label="Proprietor">{inspection.business.ownerName}</DetailRow>
            ) : null}
            {inspection.business.contact ? (
              <DetailRow label="Contact">{inspection.business.contact}</DetailRow>
            ) : null}
            <DetailRow label="Location">
              <span className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
                <span>
                  {inspection.location.address}
                  {inspection.location.district ? (
                    <span className="block text-xs text-ink-muted">
                      {inspection.location.district}
                      {inspection.location.state ? `, ${inspection.location.state}` : ''}
                    </span>
                  ) : null}
                </span>
              </span>
            </DetailRow>
            <DetailRow label="Commodity">{inspection.productName ?? '—'}</DetailRow>
            <DetailRow label="Category">{categoryLabel(inspection.productCategory)}</DetailRow>
            <DetailRow label="Recorded">{formatDateTime(inspection.createdAt)}</DetailRow>
            <DetailRow label="Last updated">{formatDateTime(inspection.updatedAt)}</DetailRow>
            {inspection.finalizedAt ? (
              <DetailRow label="Filed">{formatDateTime(inspection.finalizedAt)}</DetailRow>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader icon={UserRound} title="Inspector" />
          <CardBody>
            <div className="flex items-center gap-3">
              <Avatar name={inspection.inspector.name} size={42} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{inspection.inspector.name}</p>
                <Badge tone="info" className="mt-1.5">
                  {humanise(inspection.inspector.role)}
                </Badge>
              </div>
            </div>
          </CardBody>
        </Card>

        {inspection.complianceResult ? (
          <Card>
            <CardHeader icon={ShieldAlert} title="Verdict" />
            <CardBody className="space-y-3">
              <ComplianceBadge status={inspection.complianceResult.status} />
              {/*
                ── NO SCORE AGAINST A SINGLE RECORD ──────────────────────────

                A "Compliance score 67/100" stood here. Nobody could say what
                it was 67% *of*: it is the share of the checks the engine could
                decide that this package met, with every inapplicable rule and
                every unmeasured one outside the fraction. Printed beside a
                verdict it reads as a grade, as though the package were 67%
                legal — and no packaged commodity is. One missing MRP out of
                twenty checks scores 95%, and rule 6(1)(e) is graded CRITICAL.

                The inspector app dropped it for that reason and states the
                counts instead; this is the console catching up. The figure is
                still computed and still on the record — it is defensible as an
                aggregate over many inspections, which is the only place it now
                appears.
              */}
              <Divider />
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  Rule set applied
                </p>
                <p className="mt-1 text-sm text-ink">{inspection.complianceResult.ruleSetLabel}</p>
                <p className="font-mono text-2xs text-ink-muted">
                  {inspection.complianceResult.ruleSetId}
                </p>
              </div>
            </CardBody>
          </Card>
        ) : null}
      </div>

      {inspection.notes || inspection.finalNotes ? (
        <Card className="lg:col-span-3">
          <CardHeader icon={MessageSquare} title="Inspector notes" />
          <CardBody className="space-y-3">
            {inspection.notes ? (
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  Field note
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink">{inspection.notes}</p>
              </div>
            ) : null}
            {inspection.finalNotes ? (
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  Closing note
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink">{inspection.finalNotes}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/* ── Evidence ─────────────────────────────────────────────────────────────── */

function EvidenceTab({ inspection }: { inspection: Inspection }) {
  const space = inspection.aiAnalysis?.bboxSpace ?? { width: 800, height: 1000 };

  // Every located declaration, drawn on the face it was read from.
  const marks: EvidenceMark[] = inspection.extractedFields
    .filter((field) => field.bbox)
    .map((field) => ({
      label: field.label,
      bbox: field.bbox,
      sourceImageId: field.sourceImageId,
      tone: field.aiValue === null ? 'violation' : field.confidence < 0.75 ? 'review' : 'brand',
    }));

  return (
    <Card>
      <CardHeader
        icon={Images}
        title="Captured package faces"
        description="Boxes mark where each declaration was read. Select an image to enlarge."
      />
      <CardBody>
        <EvidenceGallery images={inspection.images} marks={marks} space={space} />
      </CardBody>
    </Card>
  );
}

/* ── AI analysis ──────────────────────────────────────────────────────────── */

function AnalysisTab({ inspection }: { inspection: Inspection }) {
  const analysis = inspection.aiAnalysis;

  if (!analysis) {
    return (
      <Card>
        <EmptyState
          icon={Bot}
          title="This inspection has not been analysed"
          description="Declarations are extracted when the inspector submits the captured images for analysis."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Notice tone="review" icon={FlaskConical}>
        <strong className="font-semibold">This is a machine extraction, not a finding.</strong>{' '}
        The values below are what an automated reader believed it saw on the package. They carry a
        confidence, they are not a legal determination, and each one remains subject to inspector
        verification.
      </Notice>

      {/* A quarter of the grid left the engine card too narrow for a date or a
          badge to sit beside its label; a third, with the rows stacked, holds
          both — and the table beside it still clears its 46rem. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader icon={Cpu} title="Engine" />
          <CardBody className="py-1">
            <dl>
              <DetailRow label="Model" stacked>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {analysis.engine === 'MOCK' ? 'Mock Analyzer' : humanise(analysis.engine)}
                  {analysis.engine === 'MOCK' ? (
                    <Badge tone="review">Simulated</Badge>
                  ) : null}
                </span>
              </DetailRow>
              <DetailRow label="Version" mono stacked>
                {analysis.engineVersion}
              </DetailRow>
              <DetailRow label="Processing time" stacked>
                <span className="flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                  <span className="tabular">{analysis.processingMs} ms</span>
                </span>
              </DetailRow>
              <DetailRow label="Analysed" stacked>
                {formatDateTime(analysis.analysedAt)}
              </DetailRow>
              <DetailRow label="Images used" mono stacked>
                {analysis.imageIds.length}
              </DetailRow>
              <DetailRow label="Package origin" stacked>
                {humanise(analysis.origin)}
              </DetailRow>
              <DetailRow label="Category read" stacked>
                <span className="block">{categoryLabel(analysis.category.value)}</span>
                <ConfidenceBar
                  value={analysis.category.confidence}
                  className="mt-1.5 w-full max-w-[14rem]"
                />
              </DetailRow>
              <DetailRow label="Mean confidence" stacked>
                <ConfidenceBar value={analysis.meanConfidence} className="w-full max-w-[14rem]" />
              </DetailRow>
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            icon={ScrollText}
            title="Extracted declarations"
            description="What the analyser read, with the confidence it read it at"
          />
          <FieldsTable fields={inspection.extractedFields} />
        </Card>
      </div>

      {analysis.warnings.length > 0 ? (
        <Card>
          <CardHeader icon={ShieldAlert} title="Analyser warnings" />
          <CardBody>
            <ul className="space-y-2">
              {analysis.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-2 text-sm text-ink-muted">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-review" aria-hidden />
                  {warning}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The extracted-declaration table.
 *
 * Shows the AI value and the human value in separate columns, always. Merging
 * them into one "current value" would destroy the distinction the whole record
 * depends on — and the training signal the next phase needs.
 */
function FieldsTable({ fields }: { fields: ExtractedField[] }) {
  if (fields.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-ink-muted">No declarations were extracted.</p>;
  }

  return (
    <TableWrap tableClassName="md:min-w-[46rem]">
      <THead>
        <TH>Declaration</TH>
        <TH>AI reading</TH>
        <TH className="md:w-40">Confidence</TH>
        <TH>Inspector verified</TH>
        <TH>Evidence</TH>
      </THead>
      <TBody>
        {fields.map((field) => (
          <TR key={field.name}>
            <TD label="Declaration" hideLabel>
              <span className="block text-sm font-medium text-ink">{field.label}</span>
              <span className="block font-mono text-2xs text-ink-faint">{field.name}</span>
              {field.required ? null : (
                <Badge tone="neutral" className="mt-1">
                  Optional
                </Badge>
              )}
            </TD>

            <TD label="AI reading">
              {field.aiValue === null ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violation">
                  <Ban className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  Not found
                </span>
              ) : (
                <span className="font-mono text-sm text-ink">{field.aiValue}</span>
              )}
            </TD>

            <TD label="Confidence" className="md:w-40">
              {field.aiValue === null ? (
                <span className="text-xs text-ink-faint">—</span>
              ) : (
                <ConfidenceBar value={field.confidence} className="max-md:w-40" />
              )}
            </TD>

            <TD label="Inspector verified">
              {field.reviewAction ? (
                <>
                  <Badge
                    tone={
                      field.reviewAction === 'ACCEPTED'
                        ? 'compliant'
                        : field.reviewAction === 'EDITED'
                          ? 'info'
                          : 'neutral'
                    }
                  >
                    {humanise(field.reviewAction)}
                  </Badge>
                  {field.humanVerifiedValue ? (
                    <span className="mt-1 block font-mono text-xs text-ink">
                      {field.humanVerifiedValue}
                    </span>
                  ) : null}
                  {field.humanVerifiedAt ? (
                    <span className="mt-0.5 block text-2xs text-ink-faint">
                      {formatDateTime(field.humanVerifiedAt)}
                    </span>
                  ) : null}
                  {field.reviewComment ? (
                    <span className="mt-1 block text-2xs italic text-ink-muted">
                      “{field.reviewComment}”
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-xs text-ink-faint">Not reviewed</span>
              )}
            </TD>

            <TD label="Evidence">
              {field.bbox && field.bbox[2] > field.bbox[0] ? (
                <span className="font-mono text-2xs text-ink-muted">
                  [{field.bbox.join(', ')}]
                </span>
              ) : (
                <span className="text-xs text-ink-faint">—</span>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </TableWrap>
  );
}

/* ── Compliance ───────────────────────────────────────────────────────────── */

function ComplianceTab({ inspection }: { inspection: Inspection }) {
  const result = inspection.complianceResult;
  const space = inspection.aiAnalysis?.bboxSpace ?? { width: 800, height: 1000 };

  /**
   * A scanned inspection is shown the rule engine's own account first, in its
   * own five-state vocabulary and with its citations intact. The three-state
   * summary below it is a projection kept for the charts and lists that predate
   * the engine; showing it alone would hide the distinction between "this rule
   * did not apply" and "we could not tell".
   */
  if (inspection.scan) {
    return (
      <div className="space-y-6">
        <LegalPanel scan={inspection.scan} />

        {result ? (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
              Summary view (the three-state projection the dashboard lists use)
            </summary>
            <div className="mt-4">
              <LegacyComplianceView inspection={inspection} result={result} space={space} />
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  if (!result) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="No compliance assessment yet"
          description="An assessment is produced once the captured images have been analysed."
        />
      </Card>
    );
  }

  return <LegacyComplianceView inspection={inspection} result={result} space={space} />;
}

/** The pre-rule-engine compliance view, unchanged, for records that predate it. */
function LegacyComplianceView({
  inspection,
  result,
  space,
}: {
  inspection: Inspection;
  result: NonNullable<Inspection['complianceResult']>;
  space: { width: number; height: number };
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <ComplianceBadge status={result.status} />
              <p className="mt-2 max-w-md text-sm text-ink-muted">
                Assessed against{' '}
                <span className="font-medium text-ink">{result.ruleSetLabel}</span> on{' '}
                {formatDateTime(result.evaluatedAt)}.
              </p>
            </div>
          </div>

          {/*
            The four states the engine actually reaches, each counted and named
            — the same tally the inspector app shows. It replaces a score dial
            whose needle was the same misleading fraction as the figure beside
            it, and it says the quiet part: how many rules never reached this
            package at all. A count of those dropped silently would make the
            other three read as the whole rule book.
          */}
          <dl className="flex flex-wrap gap-6">
            <VerdictCount
              label="Compliant"
              value={result.checks.filter((check) => check.result === 'PASS').length}
              tone="text-compliant"
            />
            <VerdictCount
              label="Not compliant"
              value={result.checks.filter((check) => check.result === 'FAIL').length}
              tone="text-violation"
            />
            <VerdictCount
              label="Needs review"
              value={result.checks.filter((check) => check.result === 'WARNING').length}
              tone="text-review"
            />
            <VerdictCount
              label="Not applicable"
              value={result.checks.filter((check) => check.result === 'NOT_APPLICABLE').length}
              tone="text-ink-muted"
            />
          </dl>
        </CardBody>
      </Card>

      {result.violations.length > 0 ? (
        <div className="space-y-4">
          {result.violations.map((violation) => (
            <ViolationCard
              key={violation.code}
              violation={violation}
              inspection={inspection}
              space={space}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="No violations raised"
            description="Every mandatory declaration for this commodity category was located on the package."
          />
        </Card>
      )}

      <Card>
        <CardHeader
          icon={ScrollText}
          title="All checks"
          description="Every provision evaluated against this package"
        />
        <TableWrap tableClassName="md:min-w-[42rem]">
          <THead>
            <TH>Check</TH>
            <TH>Provision</TH>
            <TH>Observed</TH>
            <TH>Result</TH>
          </THead>
          <TBody>
            {result.checks.map((check) => (
              <TR key={check.code}>
                <TD label="Check" hideLabel>
                  <span className="block text-sm text-ink">{check.title}</span>
                  <span className="block text-2xs text-ink-muted">{check.message}</span>
                </TD>
                <TD label="Provision" className="whitespace-nowrap font-mono text-xs text-ink-muted">
                  {check.ruleReference}
                </TD>
                <TD label="Observed" className="font-mono text-xs text-ink">
                  {check.observed ?? <span className="text-violation">absent</span>}
                </TD>
                <TD label="Result">
                  <Badge
                    tone={
                      check.result === 'PASS'
                        ? 'compliant'
                        : check.result === 'FAIL'
                          ? 'violation'
                          : check.result === 'WARNING'
                            ? 'review'
                            : 'neutral'
                    }
                    dot
                  >
                    {humanise(check.result)}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </TableWrap>
      </Card>

      {result.warnings.length > 0 ? (
        <Notice tone="review" icon={ShieldAlert}>
          <ul className="space-y-1">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}

/**
 * One count from the verdict tally.
 *
 * This replaced `VerdictMedallion`, a dial that drew the compliance score as an
 * arc. The arc had the same problem as the number it framed — it read as a
 * grade out of a hundred — and it added a second one: a package with one
 * critical contravention drew an almost-complete ring.
 */
function VerdictCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className={cn('mt-1 text-lg font-semibold tabular', tone)}>{value}</dd>
    </div>
  );
}

/**
 * A single finding, with the evidence beside it.
 *
 * The pairing is the point: an issue, the region of the package it refers to,
 * what was expected, what was observed, and the provision relied on — enough
 * for a supervisor to agree or disagree without opening anything else.
 */
function ViolationCard({
  violation,
  inspection,
  space,
}: {
  violation: Violation;
  inspection: Inspection;
  space: { width: number; height: number };
}) {
  const image = useMemo(() => {
    if (violation.sourceImageId) {
      const match = inspection.images.find((entry) => entry.imageId === violation.sourceImageId);
      if (match) return match;
    }
    return inspection.images[0];
  }, [violation.sourceImageId, inspection.images]);

  const drawable = violation.bbox && violation.bbox[2] > violation.bbox[0];

  return (
    <Card>
      <CardHeader
        icon={ShieldAlert}
        title={violation.title}
        description={violation.description}
        action={<SeverityBadge severity={violation.severity} />}
      />
      <CardBody className="grid gap-5 lg:grid-cols-[minmax(0,15rem)_1fr]">
        <div>
          {image ? (
            <EvidenceGallery
              images={[image]}
              space={space}
              columns="grid-cols-1"
              marks={
                drawable
                  ? [
                      {
                        label: violation.title.replace(/ not declared$/, ''),
                        bbox: violation.bbox,
                        sourceImageId: violation.sourceImageId,
                        tone: 'violation',
                      },
                    ]
                  : []
              }
            />
          ) : (
            <div className="grid aspect-[4/5] place-items-center rounded-lg border border-dashed border-line bg-surface-sunken text-xs text-ink-faint">
              No image captured
            </div>
          )}

          {!drawable ? (
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              No evidence region: the declaration was not located anywhere on the captured faces,
              which is the finding itself.
            </p>
          ) : null}
        </div>

        <dl>
          <DetailRow label="Issue">{violation.description}</DetailRow>
          <DetailRow label="Expected">{violation.expected}</DetailRow>
          <DetailRow label="Observed">
            {violation.observed ? (
              <span className="font-mono">{violation.observed}</span>
            ) : (
              <span className="font-medium text-violation">Not present on the package</span>
            )}
          </DetailRow>
          <DetailRow label="Provision" mono>
            {violation.ruleReference}
          </DetailRow>
          <DetailRow label="Category">{humanise(violation.category)}</DetailRow>
          <DetailRow label="Finding code" mono>
            {violation.code}
          </DetailRow>
          <DetailRow label="Recommendation">{violation.recommendation}</DetailRow>
          <DetailRow label="Case record">
            <Link
              to={`/violations/${encodeURIComponent(`${inspection.inspectionId}:${violation.code}`)}`}
              className="text-brand hover:underline"
            >
              Open violation record
            </Link>
          </DetailRow>
        </dl>
      </CardBody>
    </Card>
  );
}

/* ── Review ───────────────────────────────────────────────────────────────── */

/**
 * Human verification.
 *
 * Every decision here is *added* to the record — the API stores the inspector's
 * value in separate fields and never touches `aiValue`. That is what lets the
 * analysis tab keep showing both readings side by side afterwards.
 */
function ReviewTab({ inspection }: { inspection: Inspection }) {
  const queryClient = useQueryClient();
  const isSupervisor = useIsSupervisor();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');

  const mutation = useMutation({
    mutationFn: (decision: {
      fieldName: string;
      action: 'ACCEPTED' | 'EDITED' | 'MARKED_UNAVAILABLE';
      value?: string | null;
      comment?: string;
    }) => inspectionService.reviewField(inspection.id, decision),
    onSuccess: (updated) => {
      queryClient.setQueryData(['inspection', inspection.id], updated);
      // The queue and the dashboard counts both change when a field is decided.
      void queryClient.invalidateQueries({ queryKey: ['inspections'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      setEditing(null);
      setDraft('');
      setComment('');
    },
  });

  const locked = inspection.status === 'FINALIZED';

  // The fields that actually need a decision lead; everything else follows.
  const ordered = [...inspection.extractedFields].sort((a, b) => {
    const aNeeds = !a.reviewAction && (a.aiValue === null || a.confidence < 0.75);
    const bNeeds = !b.reviewAction && (b.aiValue === null || b.confidence < 0.75);
    if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
    return a.confidence - b.confidence;
  });

  return (
    <div className="space-y-4">
      {locked ? (
        <Notice tone="neutral" icon={BadgeCheck}>
          This inspection has been filed. The record is closed and its readings can no longer be
          amended.
        </Notice>
      ) : !isSupervisor ? (
        <Notice tone="info" icon={UserRound}>
          Review decisions are recorded by the inspector who carried out the inspection, or by a
          supervisor.
        </Notice>
      ) : null}

      {mutation.error ? (
        <Notice tone="violation" icon={ShieldAlert}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'The decision could not be recorded.'}
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          icon={UserRound}
          title="Declaration verification"
          description="Confirm, correct or mark unavailable. The original AI reading is always retained."
          action={
            inspection.review ? (
              <span className="text-xs text-ink-muted">
                <span className="font-medium text-ink tabular">
                  {inspection.review.completedFieldCount}
                </span>{' '}
                verified ·{' '}
                <span className="font-medium text-ink tabular">
                  {inspection.review.pendingFieldCount}
                </span>{' '}
                pending
              </span>
            ) : null
          }
        />

        <div className="divide-y divide-line">
          {ordered.map((field) => {
            const needsAttention =
              !field.reviewAction && (field.aiValue === null || field.confidence < 0.75);
            const isEditing = editing === field.name;

            return (
              <div key={field.name} className={cn('p-5', needsAttention && 'bg-review-soft/30')}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{field.label}</h3>
                      {needsAttention ? <Badge tone="review">Needs attention</Badge> : null}
                      {field.reviewAction ? (
                        <Badge
                          tone={field.reviewAction === 'ACCEPTED' ? 'compliant' : 'info'}
                        >
                          {humanise(field.reviewAction)}
                        </Badge>
                      ) : null}
                    </div>

                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                          AI reading — never overwritten
                        </dt>
                        <dd className="mt-1 font-mono text-sm text-ink">
                          {field.aiValue ?? (
                            <span className="not-italic font-sans text-violation">Not found</span>
                          )}
                        </dd>
                        {field.aiValue !== null ? (
                          <dd className="mt-1.5 max-w-[12rem]">
                            <ConfidenceBar value={field.confidence} />
                          </dd>
                        ) : null}
                      </div>

                      <div>
                        <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                          Inspector determination
                        </dt>
                        <dd className="mt-1 font-mono text-sm text-ink">
                          {field.humanVerifiedValue ??
                            (field.reviewAction === 'MARKED_UNAVAILABLE' ? (
                              <span className="font-sans text-ink-muted">
                                Marked unavailable
                              </span>
                            ) : field.reviewAction === 'ACCEPTED' ? (
                              <span className="font-sans text-ink-muted">
                                AI reading accepted
                              </span>
                            ) : (
                              <span className="font-sans text-ink-faint">Awaiting decision</span>
                            ))}
                        </dd>
                        {field.humanVerifiedAt ? (
                          <dd className="mt-0.5 text-2xs text-ink-faint">
                            {formatDateTime(field.humanVerifiedAt)}
                          </dd>
                        ) : null}
                      </div>
                    </dl>

                    {field.reviewComment ? (
                      <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-xs italic text-ink-muted">
                        “{field.reviewComment}”
                      </p>
                    ) : null}
                  </div>

                  {!locked ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={CheckCircle2}
                        disabled={mutation.isPending || field.aiValue === null}
                        onClick={() =>
                          mutation.mutate({ fieldName: field.name, action: 'ACCEPTED' })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={PencilLine}
                        disabled={mutation.isPending}
                        onClick={() => {
                          setEditing(isEditing ? null : field.name);
                          setDraft(field.humanVerifiedValue ?? field.aiValue ?? '');
                          setComment('');
                        }}
                      >
                        Correct
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Ban}
                        disabled={mutation.isPending}
                        onClick={() =>
                          mutation.mutate({
                            fieldName: field.name,
                            action: 'MARKED_UNAVAILABLE',
                          })
                        }
                      >
                        Unavailable
                      </Button>
                    </div>
                  ) : null}
                </div>

                {isEditing && !locked ? (
                  <div className="mt-4 space-y-3 rounded-lg border border-line bg-surface-sunken p-4">
                    <Input
                      label="Corrected value"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="What the declaration actually reads"
                      autoFocus
                    />
                    <Textarea
                      label="Comment (optional)"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Why the reading was corrected"
                      rows={2}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        loading={mutation.isPending}
                        disabled={!draft.trim()}
                        onClick={() =>
                          mutation.mutate({
                            fieldName: field.name,
                            action: 'EDITED',
                            value: draft.trim(),
                            comment: comment.trim() || undefined,
                          })
                        }
                      >
                        Save correction
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ── Report ───────────────────────────────────────────────────────────────── */

function ReportTab({ inspection }: { inspection: Inspection }) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['inspection-report', inspection.id],
    queryFn: () => inspectionService.getReport(inspection.id),
  });

  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  async function download() {
    setPrinting(true);
    setPrintError(null);
    try {
      await reportService.printReport(inspection.id, inspection.inspectionId);
    } catch (cause) {
      setPrintError(
        cause instanceof Error
          ? `The report could not be opened. ${cause.message}`
          : 'The report could not be opened.',
      );
    } finally {
      setPrinting(false);
    }
  }

  if (isPending) {
    return (
      <Card>
        <CardBody className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </CardBody>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {printError ? (
        <Notice tone="violation" icon={FileBarChart}>
          {printError}
        </Notice>
      ) : (
        <Notice tone="info" icon={FileBarChart}>
          Download opens the report the server renders from this record — the same document the
          inspector app produces — and hands it to the browser's print dialogue, where it saves as
          PDF. The payload below is that document's data.
        </Notice>
      )}

      <Card>
        <CardHeader
          icon={FileBarChart}
          title="Inspection report"
          description={`Generated ${formatDateTime(data?.generatedAt)}`}
          action={
            <Button
              size="sm"
              icon={Download}
              loading={printing}
              onClick={() => void download()}
            >
              Download PDF
            </Button>
          }
        />
        <CardBody>
          <pre className="scroll-slim max-h-[32rem] overflow-auto rounded-lg bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-ink">
            {JSON.stringify(data, null, 2)}
          </pre>
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */

function DetailSkeleton() {
  return (
    <>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="mb-5 h-10 w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5 lg:col-span-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-4" />
          ))}
        </Card>
        <Card className="space-y-3 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12" />
        </Card>
      </div>
    </>
  );
}
