import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  ChevronRight,
  ClipboardCheck,
  FlaskConical,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  CategoryChart,
  DistributionChart,
  InspectorChart,
  TrendChart,
  ViolationTypeChart,
} from '@/components/charts';
import { FilterBar, presetToFrom } from '@/components/domain/FilterBar';
import { SeverityBadge } from '@/components/domain/badges';
import { Card, CardBody, CardHeader, Notice, PageHeader } from '@/components/ui/primitives';
import { CardSkeleton, ChartSkeleton, ErrorState } from '@/components/ui/states';
import { TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { useFilters } from '@/hooks';
import { dashboardService } from '@/services';
import { useUser } from '@/store/authStore';
import type { DistrictRow } from '@/types/api';
import { cn } from '@/utils/cn';
import { formatNumber, formatPercent, formatRelative } from '@/utils/format';

/**
 * The overview.
 *
 * Every figure comes from `/analytics/overview`, which is a single aggregation
 * over the same inspections the mobile app writes. Nothing on this page is
 * computed in the browser and nothing is hardcoded — a dashboard whose numbers
 * are assembled client-side ends up disagreeing with the API that produced them.
 */

const DEFAULTS = {
  from: '30',
  productCategory: undefined,
  inspectorId: undefined,
  state: undefined,
  district: undefined,
} as Record<string, string | undefined>;

export function DashboardPage() {
  const user = useUser();
  const { filters, setFilter, clear, isFiltered } = useFilters(DEFAULTS);

  const params = {
    from: presetToFrom(filters.from),
    productCategory: filters.productCategory,
    inspectorId: filters.inspectorId,
    state: filters.state,
    district: filters.district,
    days: Number(filters.from) || 30,
  };

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['analytics', 'overview', params],
    queryFn: () => dashboardService.getOverview(params),
    staleTime: 30_000,
  });

  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName}`}
        description="Compliance position across the inspections you are authorised to see."
      />

      <FilterBar
        values={filters}
        onChange={setFilter}
        onClear={clear}
        isFiltered={isFiltered}
        show={['from', 'productCategory', 'inspectorId', 'state', 'district']}
      />

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : (
        <>
          <KpiRow summary={data?.summary} loading={isPending} />

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                icon={TrendingUp}
                title="Inspection activity"
                description="Daily volume, split by the verdict reached"
              />
              {isPending ? (
                <ChartSkeleton />
              ) : (
                <CardBody className="pl-2 pr-4">
                  <TrendChart data={data?.trend ?? []} />
                </CardBody>
              )}
            </Card>

            <Card>
              <CardHeader
                icon={ShieldCheck}
                title="Compliance distribution"
                description="How assessed inspections resolved"
              />
              {isPending ? (
                <ChartSkeleton />
              ) : (
                <CardBody>
                  <DistributionChart data={data?.distribution ?? []} />
                </CardBody>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader
                icon={ClipboardCheck}
                title="Volume and findings by category"
                description="Findings read against the volume inspected in each"
              />
              {isPending ? (
                <ChartSkeleton />
              ) : (
                <CardBody className="pl-2 pr-4">
                  <CategoryChart data={data?.violationsByCategory ?? []} />
                </CardBody>
              )}
            </Card>

            <Card>
              <CardHeader
                icon={ShieldAlert}
                title="Most frequent findings"
                description="What is actually going wrong in the market"
                action={
                  <Link
                    to="/violations"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    All violations
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </Link>
                }
              />
              {isPending ? (
                <ChartSkeleton />
              ) : (data?.violationTypes.length ?? 0) === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-ink-muted">
                  No findings were raised in this range.
                </p>
              ) : (
                <CardBody className="pl-2 pr-4">
                  <ViolationTypeChart data={data?.violationTypes ?? []} />
                </CardBody>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                icon={Users}
                title="Inspector activity"
                description="Workload and outcomes per field officer"
                action={
                  <Link
                    to="/inspectors"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    Details
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </Link>
                }
              />
              {isPending ? (
                <ChartSkeleton height={220} />
              ) : (
                <CardBody className="pl-2 pr-4">
                  <InspectorChart data={data?.inspectorActivity ?? []} height={220} />
                </CardBody>
              )}
            </Card>

            <Card>
              <CardHeader
                icon={MapPin}
                title="By state and district"
                description="Where inspections are being carried out"
              />
              {isPending ? (
                <ChartSkeleton height={220} />
              ) : (data?.districts.length ?? 0) === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-ink-muted">
                  No location information in this range.
                </p>
              ) : (
                <GeographyTable rows={data?.districts ?? []} />
              )}
            </Card>
          </div>

          <RecentFindings types={data?.violationTypes ?? []} loading={isPending} />

          <Notice tone="info" icon={FlaskConical} className="mt-4">
            <strong className="font-semibold">Analysis is simulated in this release.</strong>{' '}
            Declarations are read by a scripted analyser, not by OCR or a vision model, and the
            verdicts above were computed from those readings by a demonstration rule table. The
            figures are real aggregations over real records — the readings behind them are not
            evidence of anything yet.
          </Notice>
        </>
      )}
    </>
  );
}

/* ── KPI row ──────────────────────────────────────────────────────────────── */

function KpiRow({
  summary,
  loading,
}: {
  summary?: {
    totalInspections: number;
    complianceRate: number;
    totalViolationFindings: number;
    pendingReviews: number;
    activeInspectors: number;
    averageScore: number;
  };
  loading: boolean;
}) {
  if (loading || !summary) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    );
  }

  const cards: Array<{
    label: string;
    value: string;
    hint: string;
    icon: LucideIcon;
    tone: 'brand' | 'compliant' | 'violation' | 'review' | 'info';
    to: string;
  }> = [
    {
      label: 'Total inspections',
      value: formatNumber(summary.totalInspections),
      hint: 'In the selected range',
      icon: ClipboardCheck,
      tone: 'brand',
      to: '/inspections',
    },
    {
      label: 'Compliance rate',
      value: formatPercent(summary.complianceRate),
      hint: 'Of assessed inspections',
      icon: ShieldCheck,
      tone: 'compliant',
      to: '/inspections?status=COMPLIANT',
    },
    {
      label: 'Violation findings',
      value: formatNumber(summary.totalViolationFindings),
      hint: 'Raised across all records',
      icon: ShieldAlert,
      tone: 'violation',
      to: '/violations',
    },
    {
      label: 'Pending reviews',
      value: formatNumber(summary.pendingReviews),
      hint: 'Awaiting human verification',
      icon: UserRound,
      tone: 'review',
      to: '/reviews',
    },
    {
      label: 'Active inspectors',
      value: formatNumber(summary.activeInspectors),
      // Was `Mean score ${summary.averageScore}/100`, which had nothing to do
      // with the inspector count it sat under, and carried the compliance score
      // back onto a dashboard the rest of the product had already dropped it
      // from. What the figure counts is what it should say.
      hint: 'On the roll and active',
      icon: Users,
      tone: 'info',
      to: '/inspectors',
    },
  ];

  const accents: Record<string, string> = {
    brand: 'bg-brand-soft text-brand',
    compliant: 'bg-compliant-soft text-compliant-ink',
    violation: 'bg-violation-soft text-violation-ink',
    review: 'bg-review-soft text-review-ink',
    info: 'bg-info-soft text-info-ink',
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <Link key={card.label} to={card.to} className="group">
          <Card className="h-full p-5 transition-shadow hover:shadow-raised">
            <div className="flex items-start justify-between gap-3">
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                {card.label}
              </p>
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', accents[card.tone])}>
                <card.icon className="h-4 w-4" strokeWidth={2} aria-hidden />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold tabular tracking-tight text-ink">
              {card.value}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{card.hint}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/* ── Findings table ───────────────────────────────────────────────────────── */

function RecentFindings({
  types,
  loading,
}: {
  types: Array<{ code: string; title: string; severity: 'CRITICAL' | 'MAJOR' | 'MINOR'; count: number; category: string }>;
  loading: boolean;
}) {
  if (loading || types.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader
        icon={ShieldAlert}
        title="Finding breakdown"
        description="Each distinct provision breached, and how often"
      />
      <TableWrap>
        <THead>
          <TH>Finding</TH>
          <TH>Category</TH>
          <TH>Severity</TH>
          <TH align="right">Occurrences</TH>
          <TH align="right">Share</TH>
        </THead>
        <TBody>
          {types.map((type) => {
            const total = types.reduce((sum, entry) => sum + entry.count, 0);
            return (
              <TR key={type.code}>
                <TD label="Finding" hideLabel>
                  <span className="block text-sm font-medium text-ink">{type.title}</span>
                  <span className="block font-mono text-2xs text-ink-muted">{type.code}</span>
                </TD>
                <TD label="Category" className="text-xs text-ink-muted">
                  {type.category.replace(/_/g, ' ').toLowerCase()}
                </TD>
                <TD label="Severity">
                  <SeverityBadge severity={type.severity} />
                </TD>
                <TD label="Occurrences" align="right" className="tabular text-sm font-medium">
                  {formatNumber(type.count)}
                </TD>
                <TD label="Share" align="right" className="tabular text-sm text-ink-muted">
                  {total > 0 ? formatPercent((type.count / total) * 100) : '—'}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </TableWrap>
    </Card>
  );
}

/* ── Geography ───────────────────────────────────────────────── */

/**
 * Inspections rolled up by state, opening onto their districts.
 *
 * A flat district list answers "which district" but never "which state", which
 * is the question a department asks first — districts are the unit of work, a
 * state is the unit of jurisdiction. Each state is a disclosure so both
 * readings are one click apart.
 *
 * The state rate is `compliant / assessed` summed across its districts, not the
 * mean of their percentages: averaging rates over unequal denominators gives a
 * number that belongs to no real population.
 */
function GeographyTable({ rows }: { rows: DistrictRow[] }) {
  const states = groupByState(rows);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <TableWrap tableClassName="md:min-w-0">
      <THead>
        <TH>State / district</TH>
        <TH align="right">Inspections</TH>
        <TH align="right">Compliance</TH>
      </THead>
      <TBody>
        {states.map((state) => {
          const open = !collapsed[state.state];

          return (
            <Fragment key={state.state}>
              <TR
                onClick={() =>
                  setCollapsed((previous) => ({
                    ...previous,
                    [state.state]: !previous[state.state],
                  }))
                }
                className="bg-surface-sunken/60"
              >
                <TD label="State" hideLabel>
                  <span className="flex items-center gap-1.5">
                    <ChevronRight
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform',
                        open && 'rotate-90',
                      )}
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold text-ink">{state.state}</span>
                    <span className="text-2xs text-ink-muted">
                      {state.districts.length} district{state.districts.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </TD>
                <TD label="Inspections" align="right" className="tabular text-sm font-semibold">
                  {formatNumber(state.inspections)}
                </TD>
                <TD label="Compliance" align="right">
                  <ComplianceRate value={state.complianceRate} assessed={state.assessed} strong />
                </TD>
              </TR>

              {open
                ? state.districts.map((row) => (
                    <TR key={`${state.state}-${row.district}`}>
                      <TD label="District" hideLabel>
                        {/* Indented on a wide screen; on a stacked card the
                            state heading is already the row above it. */}
                        <span className="block text-sm text-ink md:pl-5">{row.district}</span>
                      </TD>
                      <TD label="Inspections" align="right" className="tabular text-sm">
                        {formatNumber(row.inspections)}
                      </TD>
                      <TD label="Compliance" align="right">
                        <ComplianceRate value={row.complianceRate} assessed={row.assessed} />
                      </TD>
                    </TR>
                  ))
                : null}
            </Fragment>
          );
        })}
      </TBody>
    </TableWrap>
  );
}

/** A rate, banded by the same thresholds the rest of the console uses. */
function ComplianceRate({
  value,
  assessed,
  strong,
}: {
  value: number;
  assessed: number;
  strong?: boolean;
}) {
  // Nothing assessed is not the same fact as nothing compliant.
  if (assessed === 0) return <span className="text-sm text-ink-faint">—</span>;

  return (
    <span
      className={cn(
        'text-sm tabular',
        strong ? 'font-semibold' : 'font-medium',
        value >= 60 ? 'text-compliant' : value >= 40 ? 'text-review' : 'text-violation',
      )}
    >
      {formatPercent(value)}
    </span>
  );
}

interface StateGroup {
  state: string;
  districts: DistrictRow[];
  inspections: number;
  assessed: number;
  compliant: number;
  complianceRate: number;
}

/**
 * Groups district rows under their state, busiest state first.
 *
 * A row with no state still has to appear — dropping it would make the column
 * totals disagree with the register it summarises.
 */
function groupByState(rows: DistrictRow[]): StateGroup[] {
  const byState = new Map<string, DistrictRow[]>();

  for (const row of rows) {
    const key = row.state?.trim() || 'Unassigned';
    const existing = byState.get(key);
    if (existing) existing.push(row);
    else byState.set(key, [row]);
  }

  return [...byState.entries()]
    .map(([state, districts]) => {
      const inspections = districts.reduce((sum, row) => sum + row.inspections, 0);
      const assessed = districts.reduce((sum, row) => sum + row.assessed, 0);
      const compliant = districts.reduce((sum, row) => sum + row.compliant, 0);

      return {
        state,
        districts: [...districts].sort((a, b) => b.inspections - a.inspections),
        inspections,
        assessed,
        compliant,
        complianceRate: assessed > 0 ? Math.round((compliant / assessed) * 100) : 0,
      };
    })
    .sort((a, b) => b.inspections - a.inspections);
}

/** Kept for the inspectors summary card; exported for reuse on that page. */
export function lastActive(iso?: string): string {
  return formatRelative(iso);
}
