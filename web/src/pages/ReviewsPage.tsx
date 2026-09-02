import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { FilterBar, presetToFrom } from '@/components/domain/FilterBar';
import { Avatar, Badge, Card, ConfidenceBar, Notice, PageHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, NoResults, TableSkeleton } from '@/components/ui/states';
import { Pagination, TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { useFilters } from '@/hooks';
import { inspectionService } from '@/services';
import type { Inspection } from '@/types/api';
import { categoryLabel, formatDateTime } from '@/utils/format';

/**
 * The review queue.
 *
 * Only inspections the system has explicitly escalated — `REVIEW_REQUIRED` —
 * appear here. That status is set when a mandatory declaration was read below
 * the confidence threshold, which is the system saying it is not willing to
 * assert a verdict on its own. This page is where a person resolves that.
 */

const DEFAULTS = {
  search: undefined,
  productCategory: undefined,
  inspectorId: undefined,
  from: undefined,
} as Record<string, string | undefined>;

export function ReviewsPage() {
  const navigate = useNavigate();
  const { filters, setFilter, page, setPage, pageSize, setPageSize, clear, isFiltered } =
    useFilters(DEFAULTS);

  const params = {
    page,
    pageSize,
    status: 'REVIEW_REQUIRED',
    search: filters.search,
    productCategory: filters.productCategory,
    inspectorId: filters.inspectorId,
    from: presetToFrom(filters.from),
  };

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['inspections', 'reviews', params],
    queryFn: () => inspectionService.listInspections(params),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Review Centre"
        description="Inspections the analyser could not resolve on its own, awaiting human verification."
      />

      <Notice tone="review" icon={UserRound} className="mb-4">
        A record reaches this queue when a mandatory declaration was read below the confidence
        threshold, or could not be read at all. Confirming or correcting a reading here{' '}
        <strong className="font-semibold">adds</strong> to the record — the original machine
        reading is retained alongside it, never replaced.
      </Notice>

      <FilterBar
        values={filters}
        onChange={setFilter}
        onClear={clear}
        isFiltered={isFiltered}
        show={['search', 'productCategory', 'inspectorId', 'from']}
        searchPlaceholder="Search reference, business or product…"
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
              icon={CheckCircle2}
              title="Nothing awaiting review"
              description="Every inspection has either been resolved automatically or already verified by an inspector."
              action={
                <Link
                  to="/inspections"
                  className="text-sm font-medium text-brand hover:underline"
                >
                  View all inspections
                </Link>
              }
            />
          )
        ) : (
          <>
            <TableWrap>
              <THead>
                <TH>Inspection</TH>
                <TH>Product</TH>
                <TH>Issue</TH>
                <TH>AI confidence</TH>
                <TH>Inspector</TH>
                <TH>Date</TH>
                <TH align="right">Action</TH>
              </THead>
              <TBody>
                {data?.items.map((inspection) => (
                  <TR
                    key={inspection.id}
                    onClick={() => navigate(`/inspections/${inspection.id}?tab=review`)}
                  >
                    <TD label="Inspection" hideLabel>
                      <span className="block font-mono text-xs font-medium text-ink">
                        {inspection.inspectionId}
                      </span>
                      <span className="mt-0.5 block max-w-full md:max-w-[12rem] truncate text-2xs text-ink-muted">
                        {inspection.business.name}
                      </span>
                    </TD>

                    <TD label="Product">
                      <span className="block max-w-full md:max-w-[12rem] truncate text-sm text-ink">
                        {inspection.productName ?? '—'}
                      </span>
                      <span className="block text-2xs text-ink-muted">
                        {categoryLabel(inspection.productCategory)}
                      </span>
                    </TD>

                    <TD label="Issue">
                      <IssueSummary inspection={inspection} />
                    </TD>

                    <TD label="AI confidence" className="md:w-40">
                      {inspection.aiAnalysis ? (
                        <ConfidenceBar value={inspection.aiAnalysis.meanConfidence} />
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </TD>

                    <TD label="Inspector">
                      <span className="flex items-center gap-2">
                        <Avatar name={inspection.inspector.name} size={24} />
                        <span className="max-w-full md:max-w-[8rem] truncate text-xs text-ink">
                          {inspection.inspector.name}
                        </span>
                      </span>
                    </TD>

                    <TD label="Date" className="whitespace-nowrap text-xs text-ink-muted">
                      {formatDateTime(inspection.createdAt)}
                    </TD>

                    <TD label="Action" align="right">
                      <span
                        onClick={(event) => event.stopPropagation()}
                        role="presentation"
                        className="inline-flex"
                      >
                        <Link
                          to={`/inspections/${inspection.id}?tab=review`}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand transition-colors hover:brightness-95"
                        >
                          Review
                          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        </Link>
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

/**
 * Why this record is in the queue.
 *
 * Counts the fields that actually need a decision rather than restating the
 * status — "3 low-confidence readings" tells a supervisor how much work the row
 * represents; "Review required" does not.
 */
function IssueSummary({ inspection }: { inspection: Inspection }) {
  const missing = inspection.extractedFields.filter(
    (field) => field.required && field.aiValue === null && !field.reviewAction,
  ).length;

  const uncertain = inspection.extractedFields.filter(
    (field) => field.aiValue !== null && field.confidence < 0.75 && !field.reviewAction,
  ).length;

  if (missing === 0 && uncertain === 0) {
    return <span className="text-xs text-ink-muted">All readings verified</span>;
  }

  return (
    <span className="flex flex-wrap gap-1">
      {missing > 0 ? (
        <Badge tone="violation">
          {missing} not found
        </Badge>
      ) : null}
      {uncertain > 0 ? (
        <Badge tone="review">
          {uncertain} low confidence
        </Badge>
      ) : null}
    </span>
  );
}
