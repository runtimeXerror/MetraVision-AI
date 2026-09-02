import {
  BookOpen,
  Camera,
  ChevronDown,
  Construction,
  ExternalLink,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';

import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui/primitives';
import type { ComplianceIssue, ScanRecord } from '@/types/api';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/format';

/**
 * ── THE LEGAL LAYER, ON THE DASHBOARD ───────────────────────────────────────
 *
 * The rule engine's own account of a scan, in the engine's own vocabulary.
 *
 * The dashboard's older tables speak in three states — compliant, violation,
 * review — because that is what the pre-rule-engine workflow produced. The
 * engine speaks in five, and the two it adds are the honest ones:
 * NOT_APPLICABLE (this rule does not reach this package) and
 * INSUFFICIENT_EVIDENCE (nothing was captured that could answer the question).
 * Collapsing those into "review" is fine for a list; it is not fine on the page
 * where a supervisor decides whether to open a file.
 *
 * So this panel shows the counts unmerged, names the corpus version the verdict
 * rests on, and puts each finding next to the clause, the notification and the
 * line of text it came from. Nothing here composes a legal explanation — every
 * legal string is printed exactly as the backend's rule corpus supplied it.
 * ────────────────────────────────────────────────────────────────────────────
 */

const CLASSIFICATION_TONE = {
  POTENTIAL_VIOLATION: 'violation',
  REVIEW: 'review',
  INFO: 'neutral',
} as const;

const CLASSIFICATION_LABEL = {
  POTENTIAL_VIOLATION: 'Potential violation',
  REVIEW: 'Review required',
  INFO: 'Note',
} as const;

const HEADLINE: Record<ScanRecord['legal']['status'], string> = {
  COMPLIANT: 'No compliance issues detected in the checks performed',
  VIOLATION_DETECTED: 'Potential non-compliance detected',
  REVIEW_REQUIRED: 'Inspector review required',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence to complete the checks',
  NOT_APPLICABLE: 'No implemented rule applied to this package',
};

export function LegalPanel({ scan }: { scan: ScanRecord }) {
  const { legal } = scan;
  const partialCapture = scan.captureCompleteness < 0.7;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={ScanLine}
          title={HEADLINE[legal.status]}
          description={`Evaluated by ${legal.engineVersion} against ${legal.ruleSetVersion} on ${formatDateTime(legal.evaluatedAt)}`}
        />
        <CardBody>
          {/*
            Six counts, not a score. The number that matters to a supervisor is
            how many requirements the system was able to assess at all — a
            package with twelve inapplicable rules and two unmeasurable ones has
            had six real checks run on it.
          */}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Count label="Checks performed" value={legal.summary.totalChecks} />
            <Count label="Passed" value={legal.summary.compliant} tone="text-compliant" />
            <Count
              label="Potential violations"
              value={legal.summary.violations}
              tone="text-violation"
            />
            <Count label="Review required" value={legal.summary.reviewRequired} tone="text-review" />
            <Count label="Not applicable" value={legal.summary.notApplicable} />
            <Count label="Not assessable yet" value={legal.summary.pendingCapability} />
          </dl>

          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line pt-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Rule set" value={`${legal.ruleSetVersion} · ${legal.ruleSetChecksum}`} />
            <Meta
              label="OCR"
              value={`${scan.ocr.provider}${scan.ocr.providerVersion ? ` · ${scan.ocr.providerVersion}` : ''}`}
            />
            <Meta
              label="Extraction"
              value={`${scan.extraction.engine} ${scan.extraction.engineVersion}`}
            />
            <Meta label="Package captured" value={`${Math.round(scan.captureCompleteness * 100)}%`} />
          </dl>
        </CardBody>
      </Card>

      {partialCapture ? (
        <Notice tone="review" icon={Camera}>
          Only {Math.round(scan.captureCompleteness * 100)}% of the package is taken to have been
          captured. A declaration that was not found has therefore been recorded for review rather
          than as a missing declaration — one photograph of the front face is not evidence about the
          back.
        </Notice>
      ) : null}

      {legal.summary.pendingCapability > 0 ? (
        <Notice tone="info" icon={Construction}>
          {legal.summary.pendingCapability} check
          {legal.summary.pendingCapability === 1 ? '' : 's'} could not be assessed: they need a
          physical measurement — letter height, panel placement or legibility — that this version
          does not take from an image. They are counted separately and do not affect the verdict.
        </Notice>
      ) : null}

      {scan.contextApplied.length > 0 ? (
        <Notice tone="info" icon={BookOpen}>
          <p className="font-medium">Inferred from the label, and changing which rules applied:</p>
          <ul className="mt-1 space-y-0.5">
            {scan.contextApplied.map((entry) => (
              <li key={`${entry.key}:${String(entry.value)}`}>
                <span className="font-mono text-2xs">{entry.key}</span> = {String(entry.value)} —{' '}
                {entry.basis}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {legal.issues.length === 0 ? (
        <Card>
          <CardBody className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-compliant" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">
                No issues were raised by the checks performed
              </p>
              {/*
                Deliberately not "this package is compliant". The system checked
                what it implements, on the evidence it was given, and that is
                the most it is entitled to say.
              */}
              <p className="mt-1 text-sm text-ink-muted">
                {legal.summary.compliant} of {legal.summary.totalChecks} checks passed and none
                raised an issue. This is not a determination that the package meets every legal
                requirement — see the limitations on the report.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {legal.issues.map((issue) => (
            <IssueCard key={issue.issueId} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className={cn('mt-1 text-xl font-semibold tabular text-ink', tone)}>{value}</dd>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-2xs text-ink-muted">{value}</dd>
    </div>
  );
}

/**
 * One finding, expandable to the evidence and the provision behind it.
 *
 * The two badges say different things and are labelled so. "Rule grading" is
 * the corpus's view of the requirement; the classification is this scan's view
 * of the evidence. A CRITICAL rule read from a blurred photograph produces a
 * REVIEW, and a reader who cannot see both numbers cannot see why.
 */
function IssueCard({ issue }: { issue: ComplianceIssue }) {
  const [open, setOpen] = useState(false);
  const tone = CLASSIFICATION_TONE[issue.classification];

  return (
    <Card
      className={cn(
        'border-l-4',
        issue.classification === 'POTENTIAL_VIOLATION'
          ? 'border-l-violation'
          : issue.classification === 'REVIEW'
            ? 'border-l-review'
            : 'border-l-line',
      )}
    >
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{issue.title}</h3>
            {issue.fieldLabel ? (
              <p className="mt-0.5 text-xs text-ink-muted">{issue.fieldLabel}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Badge tone={tone} dot>
              {CLASSIFICATION_LABEL[issue.classification]}
            </Badge>
            <Badge tone="neutral">Rule grading: {issue.severity}</Badge>
          </div>
        </div>

        <p className="text-sm text-ink-muted">{issue.description}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-faint">
          <span className="font-mono">{issue.source.clause ?? issue.source.rule}</span>
          <span>{issue.source.notification}</span>
          <span>in force from {issue.source.effectiveFrom}</span>
          <span>
            {issue.confidence === null
              ? 'confidence not reported by the OCR provider'
              : `read at ${Math.round(issue.confidence * 100)}%`}
          </span>
          {issue.source.officialUrl ? (
            <a
              className="inline-flex items-center gap-1 text-brand hover:underline"
              href={issue.source.officialUrl}
              target="_blank"
              rel="noreferrer"
            >
              official source <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          aria-expanded={open}
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
          {open ? 'Hide evidence and legal text' : 'Show evidence and legal text'}
        </button>

        {open ? (
          <dl className="space-y-3 rounded-md bg-surface-alt p-4 text-xs">
            <Detail label="What the rule requires" value={issue.expectedRequirement} />
            <Detail
              label="What was detected"
              value={issue.observedValue ?? 'Nothing was detected for this declaration.'}
              mono={issue.observedValue !== null}
            />

            <div>
              <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                Evidence
              </dt>
              <dd className="mt-1 space-y-1">
                {issue.evidence.length === 0 ? (
                  <p className="text-ink-muted">
                    No located evidence — nothing matching this declaration was read from the
                    images.
                  </p>
                ) : (
                  issue.evidence.map((entry, index) => (
                    <p key={`${entry.imageId}:${index}`} className="text-ink-muted">
                      <span className="font-mono text-ink">“{entry.text ?? '—'}”</span>{' '}
                      <span className="text-ink-faint">
                        {entry.imageId}
                        {entry.bbox ? ` · [${entry.bbox.join(', ')}]` : ''}
                      </span>
                    </p>
                  ))
                )}
              </dd>
            </div>

            <Detail label="Legal text relied on" value={issue.legalText} italic />
            <Detail label="How this system read it" value={issue.machineInterpretation} />
          </dl>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Detail({
  label,
  value,
  mono,
  italic,
}: {
  label: string;
  value: string;
  mono?: boolean;
  italic?: boolean;
}) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-ink-muted',
          mono && 'font-mono text-ink',
          italic && 'italic',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
