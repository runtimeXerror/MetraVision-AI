import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { FilterBar, presetToFrom } from '@/components/domain/FilterBar';
import { OpenClosedBadge, SeverityBadge } from '@/components/domain/badges';
import { Card, PageHeader } from '@/components/ui/primitives';
import { CardSkeleton, EmptyState, ErrorState, NoResults, TableSkeleton } from '@/components/ui/states';
import { Pagination, TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { useFilters } from '@/hooks';
import { violationService } from '@/services';
import { cn } from '@/utils/cn';
import { categoryLabel, formatDate, formatNumber, humanise } from '@/utils/format';

/**
 * The violation register.
 *
 * Rows here are individual findings, not inspections: one inspection that fails
 * three declarations is three entries, because three separate provisions were
 * breached and each is actionable on its own.
 *
 * A finding is OPEN while the inspection carrying it is still live, and
 * RESOLVED once that inspection is filed.
 */

const DEFAULTS = {
  search: undefined,
  severity: undefined,
  violationStatus: undefined,
  productCategory: undefined,
  state: undefined,
  district: undefined,
  inspectorId: undefined,
  from: undefined,
} as Record<string, string | undefined>;

export function ViolationsPage() {
  const navigate = useNavigate();
  const { filters, setFilter, page, setPage, pageSize, setPageSize, clear, isFiltered } =
    useFilters(DEFAULTS);

  const shared = {
    search: filters.search,
    severity: filters.severity,
    status: filters.violationStatus,
    productCategory: filters.productCategory,
    state: filters.state,
    district: filters.district,
    inspectorId: filters.inspectorId,
    from: presetToFrom(filters.from),
  };

  const listParams = { ...shared, page, pageSize };

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['violations', listParams],
    queryFn: () => violationService.listViolations(listParams),
    placeholderData: (previous) => previous,
  });

  const { data: stats, isPending: statsPending } = useQuery({
    queryKey: ['violations', 'stats', shared],
    queryFn: () => violationService.getViolationStats(shared),
  });

  return (
    <>
      <PageHeader
        title="Violations"
        description="Every finding raised against a package, with the provision relied on."
      />

      {statsPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total findings"
            value={stats.total}
            icon={ShieldAlert}
            tone="brand"
          />
          <StatCard label="Open cases" value={stats.open} icon={AlertOctagon} tone="review" />
          <StatCard label="Resolved" value={stats.resolved} icon={CheckCircle2} tone="compliant" />
          <SeverityCard critical={stats.critical} major={stats.major} minor={stats.minor} />
        </div>
      ) : null}

      <div className="mt-4">
        <FilterBar
          values={filters}
          onChange={setFilter}
          onClear={clear}
          isFiltered={isFiltered}
          show={[
            'search',
            'violationStatus',
            'severity',
            'productCategory',
            'state',
            'district',
            'inspectorId',
            'from',
          ]}
          searchPlaceholder="Search finding, business or reference…"
        />
      </div>

      <Card>
        {isPending ? (
          <TableSkeleton columns={8} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          isFiltered ? (
            <NoResults onClear={clear} />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="No violations on record"
              description="No inspection in range raised a finding against a mandatory declaration."
            />
          )
        ) : (
          <>
            <TableWrap>
              <THead>
                <TH>Violation</TH>
                <TH>Inspection</TH>
                <TH>Product</TH>
                <TH>Provision</TH>
                <TH>Location</TH>
                <TH>Severity</TH>
                <TH>Status</TH>
                <TH>Detected</TH>
              </THead>
              <TBody>
                {data?.items.map((violation) => (
                  <TR
                    key={violation.violationId}
                    onClick={() =>
                      navigate(`/violations/${encodeURIComponent(violation.violationId)}`)
                    }
                  >
                    <TD label="Violation" hideLabel>
                      <span className="block max-w-full md:max-w-[15rem] truncate text-sm font-medium text-ink">
                        {violation.title}
                      </span>
                      <span className="block text-2xs text-ink-muted">
                        {humanise(violation.category)}
                      </span>
                    </TD>

                    <TD label="Inspection">
                      <span className="block font-mono text-xs text-ink">
                        {violation.inspectionRef}
                      </span>
                      <span className="mt-0.5 block max-w-full md:max-w-[11rem] truncate text-2xs text-ink-muted">
                        {violation.business}
                      </span>
                    </TD>

                    <TD label="Product">
                      <span className="block max-w-full md:max-w-[11rem] truncate text-xs text-ink">
                        {violation.productName ?? '—'}
                      </span>
                      <span className="block text-2xs text-ink-muted">
                        {categoryLabel(violation.productCategory)}
                      </span>
                    </TD>

                    <TD label="Provision" className="whitespace-nowrap font-mono text-xs text-ink-muted">
                      {violation.ruleReference}
                    </TD>

                    <TD label="Location" className="text-xs text-ink-muted">{violation.district ?? '—'}</TD>

                    <TD label="Severity">
                      <SeverityBadge severity={violation.severity} />
                    </TD>

                    <TD label="Status">
                      <OpenClosedBadge status={violation.status} />
                    </TD>

                    <TD label="Detected" className="whitespace-nowrap text-xs text-ink-muted">
                      {formatDate(violation.detectedAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableWrap>

            {data ? <Pagination meta={data} onPageChange={setPage} onPageSizeChange={setPageSize} /> : null}
          </>
        )}
      </Card>
    </>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof ShieldAlert;
  tone: 'brand' | 'review' | 'compliant';
}) {
  const accents = {
    brand: 'bg-brand-soft text-brand',
    review: 'bg-review-soft text-review-ink',
    compliant: 'bg-compliant-soft text-compliant-ink',
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', accents[tone])}>
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular tracking-tight text-ink">
        {formatNumber(value)}
      </p>
    </Card>
  );
}

/**
 * Severity distribution.
 *
 * A stacked bar rather than three more tiles: the useful fact is the *mix*, and
 * three separate numbers make the reader do the division themselves.
 */
function SeverityCard({
  critical,
  major,
  minor,
}: {
  critical: number;
  major: number;
  minor: number;
}) {
  const total = critical + major + minor;

  const segments = [
    { label: 'Critical', value: critical, className: 'bg-violation' },
    { label: 'Major', value: major, className: 'bg-review' },
    { label: 'Minor', value: minor, className: 'bg-neutralState' },
  ];

  return (
    <Card className="p-5">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
        Severity distribution
      </p>

      {total === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No findings in range.</p>
      ) : (
        <>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line">
            {segments.map((segment) =>
              segment.value > 0 ? (
                <span
                  key={segment.label}
                  className={segment.className}
                  style={{ width: `${(segment.value / total) * 100}%` }}
                  title={`${segment.label}: ${segment.value}`}
                />
              ) : null,
            )}
          </div>

          <dl className="mt-3 space-y-1">
            {segments.map((segment) => (
              <div key={segment.label} className="flex items-center gap-2 text-xs">
                <span className={cn('h-2 w-2 rounded-full', segment.className)} aria-hidden />
                <dt className="text-ink-muted">{segment.label}</dt>
                <dd className="ml-auto font-medium tabular text-ink">{segment.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}
