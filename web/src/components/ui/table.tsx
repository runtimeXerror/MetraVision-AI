import { ChevronLeft, ChevronRight } from 'lucide-react';
import React from 'react';

import { PAGE_SIZES } from '@/hooks/useFilters';
import type { PaginationMeta } from '@/types/api';
import { formatNumber } from '@/utils/format';
import { cn } from '@/utils/cn';

import { Button } from './primitives';

/**
 * Table and pagination.
 *
 * Two layouts, one markup. From `md` up this is an ordinary table inside a
 * horizontal scroller: an enforcement table has more columns than a laptop has
 * width, and scrolling one region beats letting the whole page slide sideways.
 *
 * Below `md` the same rows restack as cards — the header row is dropped and
 * each cell becomes a `label · value` line, taking its label from the `label`
 * prop on `TD`. A supervisor checking a case on a phone gets a readable list
 * rather than a 52rem table dragged across a 380px viewport.
 *
 * Desktop rendering is unchanged by the stacking: the wrapper span inside `TD`
 * carries the value below `md` and becomes `display: contents` at `md`, so cell
 * children lay out exactly as if they were direct children of the `td`.
 */

export function TableWrap({
  children,
  className,
  tableClassName,
}: {
  children: React.ReactNode;
  className?: string;
  /** Overrides the desktop minimum width — a narrower table need not scroll. */
  tableClassName?: string;
}) {
  return (
    <div className={cn('scroll-slim w-full md:overflow-x-auto', className)}>
      <table
        className={cn(
          'w-full border-collapse text-left text-sm',
          'max-md:block md:min-w-[52rem]',
          tableClassName,
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-line bg-surface-sunken max-md:hidden">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  className,
  align = 'left',
}: {
  children?: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3.5 py-3 text-2xs font-semibold uppercase tracking-wide text-ink-faint',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return (
    <tbody className="divide-y divide-line max-md:block max-md:space-y-3 max-md:divide-y-0 max-md:p-3">
      {children}
    </tbody>
  );
}

export function TR({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      // A whole-row click needs keyboard parity, or the table is mouse-only.
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      className={cn(
        'transition-colors',
        // One card per row once the table restacks.
        'max-md:block max-md:rounded-xl max-md:border max-md:border-line max-md:px-3.5 max-md:py-2.5',
        onClick && 'cursor-pointer hover:bg-surface-sunken focus-visible:bg-surface-sunken',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className,
  align = 'left',
  label,
  hideLabel,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  /** Column name, shown beside the value once the table restacks below `md`. */
  label?: string;
  /** Suppresses the stacked label — for the cell that titles the card. */
  hideLabel?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-3.5 py-3 align-middle text-ink',
        // Stacked: one line per cell, label left, value right.
        'max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4 max-md:px-0 max-md:py-1',
        // The unlabelled cell heads the card, so it takes the full width.
        hideLabel && 'max-md:block max-md:pb-2',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {label && !hideLabel ? (
        <span
          className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-ink-faint md:hidden"
          aria-hidden
        >
          {label}
        </span>
      ) : null}
      <span
        className={cn(
          'max-md:min-w-0 max-md:text-right md:contents',
          hideLabel && 'max-md:block max-md:text-left',
        )}
      >
        {children}
      </span>
    </td>
  );
}

/**
 * Pagination.
 *
 * Shows the window rather than only the page number — "Showing 21–40 of 248"
 * is what tells a supervisor whether the filter they just applied did anything.
 * The numbered window is dropped below `sm`, where prev/next and a page counter
 * are all that fit without the control wrapping onto three lines.
 */
export function Pagination({
  meta,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  /** Supplying this shows the rows-per-page control. */
  onPageSizeChange?: (size: number) => void;
  className?: string;
}) {
  const { page, pageSize, total, totalPages } = meta;

  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-ink-muted">
          Showing <span className="font-medium text-ink tabular">{formatNumber(first)}</span>–
          <span className="font-medium text-ink tabular">{formatNumber(last)}</span> of{' '}
          <span className="font-medium text-ink tabular">{formatNumber(total)}</span>
        </p>

        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="whitespace-nowrap">Rows</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              aria-label="Rows per page"
              className={cn(
                'h-7 rounded-lg border border-line-strong bg-surface pl-2 pr-6 text-xs font-medium tabular text-ink',
                'transition-colors hover:border-ink-faint focus:border-brand focus:outline-none',
                'focus:ring-2 focus:ring-brand-ring/30',
              )}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          icon={ChevronLeft}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          Prev
        </Button>

        {/* Page numbers need more width than a phone has; this counter replaces
            them there so the control still says where you are. */}
        <span className="px-2 text-xs tabular text-ink-muted sm:hidden">
          {page} / {totalPages}
        </span>

        <div className="hidden items-center gap-1 px-1 sm:flex">
          {pageWindow(page, totalPages).map((entry, index) =>
            entry === '…' ? (
              <span key={`gap-${index}`} className="px-1.5 text-xs text-ink-faint">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPageChange(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={cn(
                  'h-8 min-w-[2rem] rounded-lg px-2 text-xs font-medium tabular transition-colors',
                  entry === page
                    ? 'bg-brand text-white'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {entry}
              </button>
            ),
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          iconRight={ChevronRight}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * Page numbers with ellipses.
 *
 * Always shows the first and last page plus a window around the current one, so
 * the control stays a fixed width however many pages there are.
 */
function pageWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const result: Array<number | '…'> = [];
  let previous = 0;

  for (const page of sorted) {
    if (previous && page - previous > 1) result.push('…');
    result.push(page);
    previous = page;
  }

  return result;
}
