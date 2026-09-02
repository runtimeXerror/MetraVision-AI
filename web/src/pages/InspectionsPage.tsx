import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Eye, FileBarChart, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { FilterBar, presetToFrom } from '@/components/domain/FilterBar';
import { StatusBadge } from '@/components/domain/badges';
import { Avatar, Card, PageHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, NoResults, TableSkeleton } from '@/components/ui/states';
import { Pagination, TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { useFilters } from '@/hooks';
import { inspectionService } from '@/services';
import { categoryLabel, formatDateParts } from '@/utils/format';

/**
 * The inspection register.
 *
 * Filtering, searching and paging are all server-side — the browser never holds
 * more than the twenty rows it is showing. That is the difference between a
 * demo with twenty-two records and a system with a year of them.
 */

const DEFAULTS = {
  search: undefined,
  status: undefined,
  productCategory: undefined,
  inspectorId: undefined,
  state: undefined,
  district: undefined,
  from: undefined,
} as Record<string, string | undefined>;

export function InspectionsPage() {
  const navigate = useNavigate();
  const { filters, setFilter, page, setPage, pageSize, setPageSize, clear, isFiltered } =
    useFilters(DEFAULTS);

  const params = {
    page,
    pageSize,
    search: filters.search,
    status: filters.status,
    productCategory: filters.productCategory,
    inspectorId: filters.inspectorId,
    state: filters.state,
    district: filters.district,
    from: presetToFrom(filters.from),
  };

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['inspections', params],
    queryFn: () => inspectionService.listInspections(params),
    // Keeps the previous page visible while the next one loads, so paging does
    // not blank the table on every click.
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Inspections"
        description="Every inspection you are authorised to see, newest first."
      />

      <FilterBar
        values={filters}
        onChange={setFilter}
        onClear={clear}
        isFiltered={isFiltered}
        show={['search', 'status', 'productCategory', 'inspectorId', 'state', 'district', 'from']}
        searchPlaceholder="Search reference, business, product or address…"
      />

      <Card>
        {isPending ? (
          <TableSkeleton columns={7} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          isFiltered ? (
            <NoResults onClear={clear} />
          ) : (
            <EmptyState
              icon={ClipboardCheck}
              title="No inspections recorded yet"
              description="Inspections created in the field application will appear here as soon as they are submitted."
            />
          )
        ) : (
          <>
            <TableWrap>
              <THead>
                <TH>Inspection</TH>
                <TH>Business</TH>
                <TH>Category</TH>
                <TH>Inspector</TH>
                <TH>Location</TH>
                <TH>Status</TH>
                <TH>Date</TH>
                <TH align="right">Actions</TH>
              </THead>
              <TBody>
                {data?.items.map((inspection) => (
                  <TR
                    key={inspection.id}
                    onClick={() => navigate(`/inspections/${inspection.id}`)}
                  >
                    <TD label="Inspection" hideLabel>
                      <span className="font-mono text-xs font-medium text-ink">
                        {inspection.inspectionId}
                      </span>
                      {inspection.productName ? (
                        <span className="mt-0.5 block max-w-full md:max-w-[11rem] truncate text-2xs text-ink-muted">
                          {inspection.productName}
                        </span>
                      ) : null}
                    </TD>

                    <TD label="Business">
                      <span className="block max-w-full md:max-w-[11rem] truncate text-sm font-medium text-ink">
                        {inspection.business.name}
                      </span>
                    </TD>

                    <TD label="Category" className="whitespace-nowrap text-xs text-ink-muted">
                      {categoryLabel(inspection.productCategory)}
                    </TD>

                    <TD label="Inspector">
                      <span className="flex items-center gap-2">
                        <Avatar name={inspection.inspector.name} size={24} />
                        <span className="min-w-0">
                          <span className="block max-w-full md:max-w-[8rem] truncate text-xs font-medium text-ink">
                            {inspection.inspector.name}
                          </span>
                          <span className="block font-mono text-2xs text-ink-faint">
                            {inspection.inspector.inspectorId}
                          </span>
                        </span>
                      </span>
                    </TD>

                    <TD label="Location">
                      <span className="block max-w-full md:max-w-[9rem] truncate text-xs text-ink-muted">
                        {inspection.location.district ?? inspection.location.address}
                      </span>
                    </TD>

                    <TD label="Status">
                      <StatusBadge status={inspection.status} />
                    </TD>

                    <TD label="Date" className="whitespace-nowrap text-xs text-ink-muted">
                      <span className="block">{formatDateParts(inspection.createdAt).date}</span>
                      <span className="block text-2xs text-ink-faint">
                        {formatDateParts(inspection.createdAt).time}
                      </span>
                    </TD>

                    <TD label="Actions" align="right">
                      {/* Stops a row-level navigation firing as well. */}
                      <span
                        className="flex items-center justify-end gap-1"
                        onClick={(event) => event.stopPropagation()}
                        role="presentation"
                      >
                        <RowAction
                          to={`/inspections/${inspection.id}`}
                          label="View inspection"
                          icon={Eye}
                        />
                        {inspection.status === 'REVIEW_REQUIRED' ? (
                          <RowAction
                            to={`/inspections/${inspection.id}?tab=review`}
                            label="Review"
                            icon={UserRound}
                          />
                        ) : null}
                        <RowAction
                          to={`/inspections/${inspection.id}?tab=report`}
                          label="Report"
                          icon={FileBarChart}
                        />
                      </span>
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

function RowAction({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Eye;
}) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-sunken hover:text-brand md:h-7 md:w-7"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
    </Link>
  );
}
