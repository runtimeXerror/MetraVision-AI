import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The row counts offered in the page-size control. */
export const PAGE_SIZES = [10, 25, 50, 100];

export const DEFAULT_PAGE_SIZE = 10;

/**
 * Filter state, held in the URL.
 *
 * Deliberately not component state: a supervisor who has narrowed a list to one
 * district and one month needs to be able to send that view to a colleague, and
 * to still have it after opening a record and pressing Back. A `useState`
 * filter bar loses both.
 */
export function useFilters<T extends Record<string, string | undefined>>(defaults: T) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const value = params.get(String(key));
      if (value !== null) result[key] = value as T[keyof T];
    }
    return result;
  }, [params, defaults]);

  const setFilter = useCallback(
    (key: keyof T, value: string | undefined) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (!value || value === 'ALL') next.delete(String(key));
          else next.set(String(key), value);

          // Any filter change invalidates the page window — staying on page 4
          // of a narrower result set shows an empty table.
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setPage = useCallback(
    (page: number) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (page <= 1) next.delete('page');
          else next.set('page', String(page));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  /**
   * Rows per page, in the URL beside the page number.
   *
   * Changing it returns to page one: page 4 of a 10-row window is not page 4 of
   * a 100-row one, and keeping the number would jump the reader somewhere they
   * did not ask to be.
   */
  const setPageSize = useCallback(
    (size: number) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (size === DEFAULT_PAGE_SIZE) next.delete('pageSize');
          else next.set('pageSize', String(size));
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => setParams({}, { replace: true }), [setParams]);

  /** Whether anything is narrowing the list, so a "Clear" affordance can hide. */
  const isFiltered = useMemo(
    () => [...params.keys()].some((key) => key !== 'page' && key !== 'pageSize'),
    [params],
  );

  const page = Number(params.get('page') ?? 1) || 1;

  // Clamped to the offered sizes: the value comes from the URL, and an
  // arbitrary one would let a link ask the API for the whole collection.
  const requested = Number(params.get('pageSize'));
  const pageSize = PAGE_SIZES.includes(requested) ? requested : DEFAULT_PAGE_SIZE;

  return { filters, setFilter, page, setPage, pageSize, setPageSize, clear, isFiltered };
}
