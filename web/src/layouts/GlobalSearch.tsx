import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Search, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { StatusBadge } from '@/components/domain/badges';
import { inspectionService, violationService } from '@/services';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/utils/cn';

/**
 * Global search.
 *
 * Queries the two collections a supervisor actually looks things up in — the
 * inspection register and the violation register — and does it server-side.
 * The debounce matters: without it a nine-character reference number is nine
 * regex scans across the collection.
 *
 * Below `sm` the field is a single icon until it is asked for, then it takes
 * the whole header row. A phone header cannot hold a search box, a menu button
 * and three account controls at once, and the field is the one of those that
 * needs the width.
 */

export function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  // Small screens only: whether the field has been asked for.
  const [expanded, setExpanded] = useState(false);
  const debounced = useDebounced(term, 300);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const enabled = debounced.trim().length >= 2;

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: async () => {
      const [inspections, violations] = await Promise.all([
        inspectionService.listInspections({ search: debounced, pageSize: 5 }),
        violationService.listViolations({ search: debounced, pageSize: 4 }),
      ]);
      return { inspections: inspections.items, violations: violations.items };
    },
    enabled,
    staleTime: 30_000,
  });

  // `/` focuses search from anywhere, unless the user is already typing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (event.key === '/' && !typing) {
        event.preventDefault();
        setExpanded(true);
        // The field may have been display:none a tick ago on a narrow screen.
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === 'Escape') {
        setOpen(false);
        setExpanded(false);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  function go(path: string) {
    setOpen(false);
    setExpanded(false);
    setTerm('');
    navigate(path);
  }

  const hasResults = (data?.inspections.length ?? 0) + (data?.violations.length ?? 0) > 0;

  return (
    <>
      {/* Trigger, small screens only. */}
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink sm:hidden"
        aria-label="Search"
        aria-expanded={expanded}
      >
        <Search className="h-[18px] w-[18px]" strokeWidth={2} />
      </button>

      <div
        ref={containerRef}
        className={cn(
          'relative w-full max-w-md',
          expanded
            ? 'max-sm:absolute max-sm:inset-x-0 max-sm:top-0 max-sm:z-50 max-sm:flex max-sm:h-16 max-sm:max-w-none max-sm:items-center max-sm:gap-2 max-sm:bg-surface max-sm:px-3'
            : 'max-sm:hidden',
        )}
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint max-sm:left-6"
          strokeWidth={2}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search inspections, businesses, violations…"
          aria-label="Search"
          className={cn(
            'h-9 w-full rounded-lg border border-line bg-surface-sunken pl-9 pr-10 text-sm text-ink',
          'max-sm:flex-1',
            'placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none',
            'focus:ring-2 focus:ring-brand-ring/30',
          )}
        />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-2xs text-ink-faint sm:block">
            /
          </kbd>

          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setOpen(false);
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink sm:hidden"
            aria-label="Close search"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>

        {open && enabled ? (
          <div className="absolute left-0 top-full z-50 mt-2 w-full animate-fade-up overflow-hidden rounded-card border border-line bg-surface shadow-pop">
            {isFetching && !data ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">Searching…</p>
            ) : !hasResults ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">
                Nothing matches “{debounced}”.
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto scroll-slim">
                {data && data.inspections.length > 0 ? (
                  <section>
                    <p className="border-b border-line bg-surface-sunken px-4 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                      Inspections
                    </p>
                    <ul>
                      {data.inspections.map((inspection) => (
                        <li key={inspection.id}>
                          <button
                            type="button"
                            onClick={() => go(`/inspections/${inspection.id}`)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-sunken"
                          >
                            <ClipboardCheck
                              className="h-4 w-4 shrink-0 text-ink-faint"
                              strokeWidth={2}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-ink">
                                {inspection.business.name}
                              </span>
                              <span className="block font-mono text-2xs text-ink-muted">
                                {inspection.inspectionId}
                              </span>
                            </span>
                            <StatusBadge status={inspection.status} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {data && data.violations.length > 0 ? (
                  <section>
                    <p className="border-y border-line bg-surface-sunken px-4 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                      Violations
                    </p>
                    <ul>
                      {data.violations.map((violation) => (
                        <li key={violation.violationId}>
                          <button
                            type="button"
                            onClick={() =>
                              go(`/violations/${encodeURIComponent(violation.violationId)}`)
                            }
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-sunken"
                          >
                            <ShieldAlert
                              className="h-4 w-4 shrink-0 text-violation"
                              strokeWidth={2}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-ink">
                                {violation.title}
                              </span>
                              <span className="block truncate text-2xs text-ink-muted">
                                {violation.business} · {violation.inspectionRef}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
