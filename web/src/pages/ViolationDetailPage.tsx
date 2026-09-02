import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Gavel,
  ScanLine,
  ScrollText,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { EvidenceGallery } from '@/components/domain/EvidencePanel';
import { OpenClosedBadge, SeverityBadge, StatusBadge } from '@/components/domain/badges';
import {
  Avatar,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { violationService } from '@/services';
import { categoryLabel, formatDateTime, humanise } from '@/utils/format';

/**
 * A single violation.
 *
 * Assembled around one question: would a supervisor be willing to put their
 * name to this finding? So it shows the finding, the package face it was read
 * from, the provision relied on, and the sequence of events that produced it —
 * in that order.
 */

export function ViolationDetailPage() {
  const { id = '' } = useParams();

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['violation', id],
    queryFn: () => violationService.getViolation(id),
    enabled: Boolean(id),
  });

  if (isPending) {
    return (
      <>
        <div className="mb-6 space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-72" />
        </div>
        <Card className="space-y-3 p-5">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-4" />
          ))}
        </Card>
      </>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;

  const { violation, inspection, status } = data;
  const space = inspection.aiAnalysis?.bboxSpace ?? { width: 800, height: 1000 };

  const sourceImage =
    inspection.images.find((image) => image.imageId === violation.sourceImageId) ??
    inspection.images[0];

  const drawable = violation.bbox && violation.bbox[2] > violation.bbox[0];

  const relatedField = inspection.extractedFields.find(
    (field) => `LMPCR-${field.name}` === violation.code,
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to="/violations"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-brand"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            All violations
          </Link>
        }
        title={violation.title}
        description={`${data.violationId} · ${humanise(violation.category)}`}
        actions={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={violation.severity} />
            <OpenClosedBadge status={status} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Evidence panel */}
        <Card className="lg:col-span-1">
          <CardHeader
            icon={ScanLine}
            title="Evidence"
            description={
              drawable
                ? 'The region of the package this finding refers to'
                : 'The package face examined'
            }
          />
          <CardBody>
            {sourceImage ? (
              <EvidenceGallery
                images={[sourceImage]}
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
              <p className="py-8 text-center text-sm text-ink-muted">
                No image was captured for this inspection.
              </p>
            )}

            {!drawable ? (
              <Notice tone="review" icon={ShieldAlert} className="mt-3">
                There is no region to highlight. The declaration was not located anywhere on the
                captured faces — that absence <em>is</em> the finding.
              </Notice>
            ) : null}

            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  Issue
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink">{violation.description}</dd>
              </div>

              {relatedField ? (
                <div>
                  <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                    Reading confidence
                  </dt>
                  <dd className="mt-1 text-sm font-medium tabular text-ink">
                    {relatedField.aiValue === null
                      ? 'Nothing read'
                      : `${Math.round(relatedField.confidence * 100)}%`}
                  </dd>
                </div>
              ) : null}

              <div>
                <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  Provision
                </dt>
                <dd className="mt-1 font-mono text-sm text-ink">{violation.ruleReference}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {/* Finding */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader icon={Gavel} title="Finding" />
            <CardBody className="py-1">
              <dl>
                <DetailRow label="Finding code" mono>
                  {violation.code}
                </DetailRow>
                <DetailRow label="Category">{humanise(violation.category)}</DetailRow>
                <DetailRow label="Severity">
                  <SeverityBadge severity={violation.severity} />
                </DetailRow>
                <DetailRow label="What is required">{violation.expected}</DetailRow>
                <DetailRow label="What was observed">
                  {violation.observed ? (
                    <span className="font-mono">{violation.observed}</span>
                  ) : (
                    <span className="font-medium text-violation">Not present on the package</span>
                  )}
                </DetailRow>
                <DetailRow label="Recommended action">{violation.recommendation}</DetailRow>
                <DetailRow label="Provision" mono>
                  {violation.ruleReference}
                </DetailRow>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon={Building2}
              title="Inspection"
              description="The record this finding was raised on"
              action={
                <Link
                  to={`/inspections/${inspection.id}`}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Open inspection
                </Link>
              }
            />
            <CardBody className="py-1">
              <dl>
                <DetailRow label="Reference" mono>
                  {inspection.inspectionId}
                </DetailRow>
                <DetailRow label="Business">{inspection.business.name}</DetailRow>
                <DetailRow label="Location">
                  {inspection.location.address}
                  {inspection.location.district ? (
                    <span className="block text-xs text-ink-muted">
                      {inspection.location.district}
                      {inspection.location.state ? `, ${inspection.location.state}` : ''}
                    </span>
                  ) : null}
                </DetailRow>
                <DetailRow label="Commodity">{inspection.productName ?? '—'}</DetailRow>
                <DetailRow label="Category">{categoryLabel(inspection.productCategory)}</DetailRow>
                <DetailRow label="Record status">
                  <StatusBadge status={inspection.status} />
                </DetailRow>
                <DetailRow label="Inspector">
                  <span className="flex items-center gap-2">
                    <Avatar name={inspection.inspector.name} size={26} />
                    <span>
                      <span className="block text-sm text-ink">{inspection.inspector.name}</span>
                      <span className="block font-mono text-2xs text-ink-muted">
                        {inspection.inspector.inspectorId}
                      </span>
                    </span>
                  </span>
                </DetailRow>
              </dl>
            </CardBody>
          </Card>

          <Timeline
            inspection={inspection}
            status={status}
            violationTitle={violation.title}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The evidence timeline.
 *
 * Built from timestamps already on the record rather than a separate audit log:
 * captured, analysed, assessed, verified, filed. It answers "how did this
 * finding come to exist", which is the first thing anyone contesting it asks.
 */
function Timeline({
  inspection,
  status,
  violationTitle,
}: {
  inspection: {
    createdAt: string;
    images: unknown[];
    aiAnalysis?: { analysedAt: string; engine: string; engineVersion: string };
    complianceResult?: { evaluatedAt: string; ruleSetLabel: string };
    review?: { lastReviewedAt?: string; completedFieldCount: number };
    finalizedAt?: string;
  };
  status: 'OPEN' | 'RESOLVED';
  violationTitle: string;
}) {
  const events: Array<{
    at?: string;
    icon: typeof ClipboardCheck;
    title: string;
    detail: string;
    tone: 'brand' | 'review' | 'violation' | 'compliant';
  }> = [
    {
      at: inspection.createdAt,
      icon: ClipboardCheck,
      title: 'Inspection recorded',
      detail: `${inspection.images.length} package face${inspection.images.length === 1 ? '' : 's'} captured in the field.`,
      tone: 'brand',
    },
  ];

  if (inspection.aiAnalysis) {
    events.push({
      at: inspection.aiAnalysis.analysedAt,
      icon: ScanLine,
      title: 'Declarations extracted',
      detail: `${inspection.aiAnalysis.engine === 'MOCK' ? 'Mock Analyzer' : inspection.aiAnalysis.engine} ${inspection.aiAnalysis.engineVersion} read the captured faces.`,
      tone: 'brand',
    });
  }

  if (inspection.complianceResult) {
    events.push({
      at: inspection.complianceResult.evaluatedAt,
      icon: ScrollText,
      title: 'Assessed against the rule set',
      detail: `${inspection.complianceResult.ruleSetLabel} applied. “${violationTitle}” raised.`,
      tone: 'violation',
    });
  }

  if (inspection.review?.lastReviewedAt) {
    events.push({
      at: inspection.review.lastReviewedAt,
      icon: UserRound,
      title: 'Verified by inspector',
      detail: `${inspection.review.completedFieldCount} declaration${inspection.review.completedFieldCount === 1 ? '' : 's'} confirmed or corrected. Machine readings retained.`,
      tone: 'review',
    });
  }

  if (inspection.finalizedAt) {
    events.push({
      at: inspection.finalizedAt,
      icon: FileCheck2,
      title: 'Record filed',
      detail: 'The inspection was closed and the finding marked resolved.',
      tone: 'compliant',
    });
  }

  const tones = {
    brand: 'bg-brand-soft text-brand',
    review: 'bg-review-soft text-review-ink',
    violation: 'bg-violation-soft text-violation-ink',
    compliant: 'bg-compliant-soft text-compliant-ink',
  };

  return (
    <Card>
      <CardHeader icon={CheckCircle2} title="Evidence timeline" description="How this finding came to exist" />
      <CardBody>
        <ol className="relative space-y-5 before:absolute before:left-[0.9375rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-line">
          {events.map((event, index) => (
            <li key={index} className="relative flex gap-3.5">
              <span
                className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-surface ${tones[event.tone]}`}
              >
                <event.icon className="h-4 w-4" strokeWidth={2} aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-medium text-ink">{event.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{event.detail}</p>
                <p className="mt-1 text-2xs text-ink-faint">{formatDateTime(event.at)}</p>
              </div>
            </li>
          ))}
        </ol>

        {status === 'OPEN' ? (
          <Notice tone="review" icon={ShieldAlert} className="mt-5">
            This case is still open — the inspection carrying it has not been filed. It will be
            marked resolved when the inspector closes the record.
          </Notice>
        ) : null}
      </CardBody>
    </Card>
  );
}
