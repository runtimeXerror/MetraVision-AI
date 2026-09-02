import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart, FileText, Share2, ShieldAlert, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { FilterBar, presetToFrom } from '@/components/domain/FilterBar';
import { ComplianceBadge, StatusBadge } from '@/components/domain/badges';
import { Button, Card, CardBody, CardHeader, Notice, PageHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, NoResults, TableSkeleton } from '@/components/ui/states';
import { Pagination, TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { useFilters } from '@/hooks';
import { reportService } from '@/services';
import { categoryLabel, formatDateTime, formatNumber } from '@/utils/format';

/**
 * Reporting.
 *
 * A report is not a stored entity — it is a rendering of an inspection, so the
 * list of "available reports" is the list of inspections that have been
 * assessed. Anything else would mean a report that can drift from the record it
 * claims to describe.
 */

const DEFAULTS = {
  search: undefined,
  status: undefined,
  productCategory: undefined,
  from: undefined,
} as Record<string, string | undefined>;

export function ReportsPage() {
  const navigate = useNavigate();
  const { filters, setFilter, page, setPage, pageSize, setPageSize, clear, isFiltered } =
    useFilters(DEFAULTS);

  const params = {
    page,
    pageSize,
    search: filters.search,
    status: filters.status,
    productCategory: filters.productCategory,
    from: presetToFrom(filters.from),
  };

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['reports', params],
    queryFn: () => reportService.listReportableInspections(params),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Reports"
        description="Inspection records available for reporting, and the department-level summaries drawn from them."
      />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <SummaryLink
          to="/dashboard"
          icon={FileBarChart}
          title="Compliance summary"
          description="Rates, trends and the distribution of verdicts across the department."
        />
        <SummaryLink
          to="/violations"
          icon={ShieldAlert}
          title="Violation report"
          description="Every finding raised, with severity, provision and case status."
        />
        <SummaryLink
          to="/inspectors"
          icon={Users}
          title="Inspector activity"
          description="Workload and outcomes per field officer."
        />
      </div>

      <Notice tone="info" icon={FileText} className="mb-4">
        Each inspection below carries a structured report payload from the API. Rendering it to a
        signed PDF belongs on the server, where the document is produced from the record itself
        rather than from whatever a browser happened to be displaying — so the download and share
        actions here are deliberately inert.
      </Notice>

      <FilterBar
        values={filters}
        onChange={setFilter}
        onClear={clear}
        isFiltered={isFiltered}
        show={['search', 'status', 'productCategory', 'from']}
        searchPlaceholder="Search reference, business or product…"
      />

      <Card>
        {isPending ? (
          <TableSkeleton columns={6} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          isFiltered ? (
            <NoResults onClear={clear} />
          ) : (
            <EmptyState
              icon={FileBarChart}
              title="No reports available"
              description="A report becomes available once an inspection has been analysed."
            />
          )
        ) : (
          <>
            <TableWrap>
              <THead>
                <TH>Inspection</TH>
                <TH>Business</TH>
                <TH>Category</TH>
                <TH>Verdict</TH>
                <TH>Record status</TH>
                <TH>Date</TH>
                <TH align="right">Report</TH>
              </THead>
              <TBody>
                {data?.items.map((inspection) => (
                  <TR
                    key={inspection.id}
                    onClick={() => navigate(`/inspections/${inspection.id}?tab=report`)}
                  >
                    <TD label="Inspection" hideLabel>
                      <span className="font-mono text-xs font-medium text-ink">
                        {inspection.inspectionId}
                      </span>
                    </TD>
                    <TD label="Business">
                      <span className="block max-w-full md:max-w-[14rem] truncate text-sm text-ink">
                        {inspection.business.name}
                      </span>
                    </TD>
                    <TD label="Category" className="whitespace-nowrap text-xs text-ink-muted">
                      {categoryLabel(inspection.productCategory)}
                    </TD>
                    <TD label="Verdict">
                      {inspection.complianceResult ? (
                        <ComplianceBadge status={inspection.complianceResult.status} />
                      ) : (
                        <span className="text-xs text-ink-faint">Not assessed</span>
                      )}
                    </TD>
                    <TD label="Record status">
                      <StatusBadge status={inspection.status} />
                    </TD>
                    <TD label="Date" className="whitespace-nowrap text-xs text-ink-muted">
                      {formatDateTime(inspection.createdAt)}
                    </TD>
                    <TD label="Report" align="right">
                      <span
                        className="flex items-center justify-end gap-1"
                        onClick={(event) => event.stopPropagation()}
                        role="presentation"
                      >
                        <Link
                          to={`/inspections/${inspection.id}?tab=report`}
                          className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand transition-colors hover:brightness-95"
                        >
                          View
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Download}
                          title="PDF export is produced server-side and is not part of this release"
                          disabled
                          aria-label="Download report (not available)"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Share2}
                          title="Sharing is issued through the departmental record system"
                          disabled
                          aria-label="Share report (not available)"
                        />
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableWrap>

            {data ? (
              <>
                <Pagination meta={data} onPageChange={setPage} onPageSizeChange={setPageSize} />
                <p className="border-t border-line px-5 py-2.5 text-2xs text-ink-faint">
                  {formatNumber(data.total)} inspection records in this view.
                </p>
              </>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

function SummaryLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: typeof FileBarChart;
  title: string;
  description: string;
}) {
  return (
    <Link to={to} className="group">
      <Card className="h-full transition-shadow hover:shadow-raised">
        <CardHeader icon={Icon} title={title} />
        <CardBody>
          <p className="text-xs leading-relaxed text-ink-muted">{description}</p>
        </CardBody>
      </Card>
    </Link>
  );
}
