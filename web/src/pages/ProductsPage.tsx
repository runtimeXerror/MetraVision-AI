import { useQuery } from '@tanstack/react-query';
import { Package, Store } from 'lucide-react';
import { Link } from 'react-router-dom';

import { FilterBar, presetToFrom } from '@/components/domain/FilterBar';
import { Badge, Card, Notice, PageHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, NoResults, TableSkeleton } from '@/components/ui/states';
import { Pagination, TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { useFilters } from '@/hooks';
import { productService } from '@/services';
import { cn } from '@/utils/cn';
import { categoryLabel, formatDate, formatNumber, formatPercent } from '@/utils/format';

/**
 * Commodities inspected.
 *
 * Not a product master — see `product.controller` for why the department has no
 * catalogue authority here. These rows are the inspection history rolled up by
 * the commodity name and category recorded at inspection time, which is the
 * question a supervisor actually asks: *which goods keep failing?*
 */

const DEFAULTS = {
  search: undefined,
  productCategory: undefined,
  from: undefined,
} as Record<string, string | undefined>;

export function ProductsPage() {
  const { filters, setFilter, page, setPage, pageSize, setPageSize, clear, isFiltered } =
    useFilters(DEFAULTS);

  const params = {
    page,
    pageSize,
    search: filters.search,
    productCategory: filters.productCategory,
    from: presetToFrom(filters.from),
  };

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['products', params],
    queryFn: () => productService.listProducts(params),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Products"
        description="Commodities inspected, rolled up across every premises they were found in."
      />

      <Notice tone="info" icon={Package} className="mb-4">
        These are derived from inspection history rather than held as a catalogue. The same
        commodity inspected at two shops is two pieces of evidence — the counts below are how often
        each was examined and how often a finding followed.
      </Notice>

      <FilterBar
        values={filters}
        onChange={setFilter}
        onClear={clear}
        isFiltered={isFiltered}
        show={['search', 'productCategory', 'from']}
        searchPlaceholder="Search commodity or business…"
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
              icon={Package}
              title="No commodities recorded"
              description="A commodity appears here once an inspection naming it has been analysed."
            />
          )
        ) : (
          <>
            <TableWrap>
              <THead>
                <TH>Commodity</TH>
                <TH>Category</TH>
                <TH>Premises</TH>
                <TH align="right">Inspections</TH>
                <TH align="right">Findings</TH>
                <TH align="right">Compliance</TH>
                <TH>Last inspected</TH>
              </THead>
              <TBody>
                {data?.items.map((product) => (
                  <TR key={product.productKey}>
                    <TD label="Commodity" hideLabel>
                      <span className="block max-w-full md:max-w-[16rem] truncate text-sm font-medium text-ink">
                        {product.productName}
                      </span>
                    </TD>

                    <TD label="Category">
                      <Badge tone="neutral">{categoryLabel(product.productCategory)}</Badge>
                    </TD>

                    <TD label="Premises">
                      <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <Store className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
                        <span className="max-w-full md:max-w-[12rem] truncate">
                          {product.businesses.slice(0, 2).join(', ')}
                          {product.businesses.length > 2
                            ? ` +${product.businesses.length - 2}`
                            : ''}
                        </span>
                      </span>
                    </TD>

                    <TD label="Inspections" align="right" className="tabular text-sm font-medium">
                      {formatNumber(product.inspections)}
                    </TD>

                    <TD label="Findings" align="right">
                      <span
                        className={cn(
                          'tabular text-sm font-medium',
                          product.violations > 0 ? 'text-violation' : 'text-ink-faint',
                        )}
                      >
                        {formatNumber(product.violations)}
                      </span>
                    </TD>

                    <TD label="Compliance" align="right">
                      <span
                        className={cn(
                          'tabular text-sm font-medium',
                          product.complianceRate >= 60
                            ? 'text-compliant'
                            : product.complianceRate >= 40
                              ? 'text-review-ink'
                              : 'text-violation',
                        )}
                      >
                        {formatPercent(product.complianceRate)}
                      </span>
                    </TD>

                    <TD label="Last inspected" className="whitespace-nowrap text-xs text-ink-muted">
                      <Link
                        to={`/inspections?search=${encodeURIComponent(product.productName)}`}
                        className="hover:text-brand hover:underline"
                      >
                        {formatDate(product.lastInspectedAt)}
                      </Link>
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
