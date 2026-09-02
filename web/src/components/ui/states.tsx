import {
  AlertTriangle,
  Inbox,
  Lock,
  RefreshCw,
  SearchX,
  Timer,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import React from 'react';

import { ApiError } from '@/services/client';
import { cn } from '@/utils/cn';

import { Button, Card } from './primitives';

/**
 * The three states every page owes the user.
 *
 * A page that renders nothing while it loads, or blanks when a request fails,
 * is indistinguishable from a broken one. These make the loading, empty and
 * error branches something a page has to pass through rather than remember.
 */

/* ── Loading ──────────────────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} />;
}

/**
 * Table placeholder that keeps the real column rhythm, so nothing jumps.
 *
 * Below `md` the table it stands in for is a stack of cards, so the placeholder
 * is too — a row of six column stubs on a phone would settle into something
 * that looks nothing like it.
 */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div
      className="divide-y divide-line max-md:space-y-3 max-md:divide-y-0 max-md:p-3"
      aria-busy="true"
      aria-label="Loading rows"
    >
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="px-5 py-3.5 max-md:rounded-xl max-md:border max-md:border-line max-md:px-3.5 max-md:py-3"
        >
          <div className="hidden items-center gap-4 md:flex">
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <Skeleton
                key={columnIndex}
                className={cn(
                  'h-3.5',
                  columnIndex === 0 ? 'w-28' : columnIndex === 1 ? 'flex-1' : 'w-20',
                )}
              />
            ))}
          </div>

          <div className="space-y-2 md:hidden">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('p-5', className)} aria-busy="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-3 h-3 w-32" />
    </Card>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="p-5" aria-busy="true" aria-label="Loading chart">
      <div className="skeleton rounded-lg" style={{ height }} />
    </div>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-sunken text-ink-faint">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** The specific empty state for a filtered list that matched nothing. */
export function NoResults({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title="No matching records"
      description="No records match the filters currently applied. Try widening the date range or clearing a filter."
      action={
        onClear ? (
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

/* ── Error ────────────────────────────────────────────────────────────────── */

/**
 * Renders a failure honestly.
 *
 * The wording is chosen from the error kind rather than showing a raw message
 * for everything: "could not reach the server" and "you do not have access"
 * lead to completely different actions, and a retry button on the second one is
 * a lie.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const kind = apiError?.kind ?? 'unknown';

  const Icon =
    kind === 'network' || kind === 'timeout'
      ? WifiOff
      : kind === 'rate_limited'
        ? Timer
        : kind === 'forbidden' || kind === 'unauthorized'
          ? Lock
          : AlertTriangle;

  const heading =
    title ??
    (kind === 'forbidden'
      ? 'You do not have access to this'
      : kind === 'not_found'
        ? 'Not found'
        : kind === 'network'
          ? 'Cannot reach the server'
          : kind === 'rate_limited'
            ? 'Too many requests'
            : 'Something went wrong');

  const message =
    apiError?.message ??
    (error instanceof Error ? error.message : 'An unexpected error occurred.');

  const canRetry = onRetry && (apiError ? apiError.retryable : true);

  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-violation-soft text-violation">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-ink">{heading}</h3>
      <p className="mt-1.5 max-w-md text-sm text-ink-muted">{message}</p>

      {kind === 'network' ? (
        <p className="mt-2 max-w-md text-xs text-ink-faint">
          Check that the backend is running on port 4000 and that{' '}
          <code className="font-mono">VITE_PROXY_TARGET</code> points at it.
        </p>
      ) : kind === 'rate_limited' ? (
        <p className="mt-2 max-w-md text-xs text-ink-faint">
          The API rate limit has been reached. Wait a moment before retrying — retrying
          immediately only extends the limit.
        </p>
      ) : null}

      {canRetry ? (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry} className="mt-5">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The one component a page uses to cover all three branches.
 *
 * Takes the query's own flags, so a page cannot accidentally render a "no
 * records" message while the first request is still in flight.
 */
export function QueryBoundary({
  isLoading,
  error,
  isEmpty,
  onRetry,
  loadingFallback,
  emptyFallback,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  loadingFallback: React.ReactNode;
  emptyFallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (isLoading) return <>{loadingFallback}</>;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty && emptyFallback) return <>{emptyFallback}</>;
  return <>{children}</>;
}
