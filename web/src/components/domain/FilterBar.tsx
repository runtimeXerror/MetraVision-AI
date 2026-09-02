import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

import { SearchableSelect, Select, SearchInput } from '@/components/ui/forms';
import { Button } from '@/components/ui/primitives';
import { userService } from '@/services';
import { useIsSupervisor } from '@/store/authStore';
import { INSPECTION_STATUSES, PRODUCT_CATEGORIES, SEVERITIES } from '@/types/api';
import { categoryLabel, statusLabel, severityLabels } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * The shared filter bar.
 *
 * Every list and the dashboard filter on the same vocabulary, so the controls
 * are declared once here and each page opts into the ones that apply to it.
 * The values live in the URL — see `useFilters` — which is what makes a
 * narrowed view something a supervisor can bookmark or send to a colleague.
 *
 * Below `md` the selects collapse behind a Filters button and open two to a
 * row: seven controls at their desktop widths would otherwise stack into a
 * full screen of chrome above the results they narrow. The group is
 * `md:contents` from `md` up, so on a wide screen the selects are direct
 * children of the same flex row and lay out exactly as they always have.
 */

export type FilterKey =
  | 'search'
  | 'status'
  | 'productCategory'
  | 'inspectorId'
  | 'state'
  | 'district'
  | 'severity'
  | 'violationStatus'
  | 'from'
  | 'to';

/**
 * Jurisdictions, state first.
 *
 * A district means nothing without its state — two states can hold districts of
 * the same name — so the two filters are declared together here and the
 * district list narrows to whatever state is chosen. Replaced by a lookup
 * endpoint when the register covers more than the states below.
 */
export const JURISDICTIONS: Array<{ state: string; districts: string[] }> = [
  { state: 'Maharashtra', districts: ['Pune', 'Nagpur'] },
  { state: 'Karnataka', districts: ['Bengaluru Urban'] },
];

/** Ranges offered instead of a free date picker — these are the questions
 *  actually asked of an enforcement dataset. */
export const DATE_PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last quarter' },
  { value: '365', label: 'Last year' },
  { value: '', label: 'All time' },
];

/**
 * Turns a preset into the ISO bound the API expects.
 *
 * Floored to the start of the day, and that is not cosmetic: this runs during
 * render, and a `Date.now()`-based value would be different on every pass. The
 * query key derived from it would then never repeat, so React Query would
 * refetch forever and the page would sit on its skeletons.
 *
 * Flooring makes the value stable for the whole day, which is also the way a
 * supervisor reads "last 7 days" — whole days, not a rolling timestamp.
 */
export function presetToFrom(days: string | undefined): string | undefined {
  if (!days) return undefined;

  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return undefined;

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (count - 1));

  return from.toISOString();
}

export function FilterBar({
  values,
  onChange,
  onClear,
  isFiltered,
  show,
  searchPlaceholder = 'Search…',
  className,
}: {
  values: Record<string, string | undefined>;
  onChange: (key: string, value: string | undefined) => void;
  onClear: () => void;
  isFiltered: boolean;
  show: FilterKey[];
  searchPlaceholder?: string;
  className?: string;
}) {
  const isSupervisor = useIsSupervisor();
  const showInspector = show.includes('inspectorId') && isSupervisor;

  // Collapsed state applies below `md` only; the group is always laid out on a
  // wide screen regardless of what this holds.
  const [open, setOpen] = useState(false);

  // What the button reports when the controls are folded away — without it a
  // narrowed list looks unfiltered on a phone.
  const appliedCount = show.filter((key) => key !== 'search' && values[key]).length;

  // Only fetched when a filter that needs it is on screen, and only for a role
  // the API will actually serve the roster to.
  const { data: inspectors = [] } = useQuery({
    queryKey: ['analytics', 'inspector-activity', 'filter'],
    queryFn: () => userService.listInspectorActivity(),
    enabled: showInspector,
    staleTime: 5 * 60_000,
  });

  // Districts of the chosen state, or every district when no state is chosen.
  const districtOptions = JURISDICTIONS.filter(
    (entry) => !values.state || entry.state === values.state,
  ).flatMap((entry) =>
    entry.districts.map((district) => ({ value: district, label: district })),
  );

  const selectContainer = 'w-full min-w-0 md:w-auto';

  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-3.5 shadow-card',
        className,
      )}
    >
      {show.includes('search') ? (
        <SearchInput
          value={values.search ?? ''}
          onChange={(value) => onChange('search', value || undefined)}
          placeholder={searchPlaceholder}
          className="w-full min-w-0 flex-1 md:min-w-[16rem]"
        />
      ) : null}

      <Button
        variant="secondary"
        icon={SlidersHorizontal}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="shrink-0 md:hidden"
      >
        Filters{appliedCount ? ` (${appliedCount})` : ''}
      </Button>

      <div
        className={cn(
          'grid w-full grid-cols-2 gap-3 md:contents',
          !open && 'hidden md:contents',
        )}
      >
        {show.includes('status') ? (
          <Select
            aria-label="Status"
            value={values.status ?? ''}
            onChange={(event) => onChange('status', event.target.value || undefined)}
            placeholder="All statuses"
            options={INSPECTION_STATUSES.map((status) => ({
              value: status,
              label: statusLabel(status),
            }))}
            containerClassName={cn(selectContainer, 'md:min-w-[9rem]')}
          />
        ) : null}

        {show.includes('violationStatus') ? (
          <Select
            aria-label="Case status"
            value={values.violationStatus ?? ''}
            onChange={(event) => onChange('violationStatus', event.target.value || undefined)}
            placeholder="Open and resolved"
            options={[
              { value: 'OPEN', label: 'Open' },
              { value: 'RESOLVED', label: 'Resolved' },
            ]}
            containerClassName={cn(selectContainer, 'md:min-w-[8.75rem]')}
          />
        ) : null}

        {show.includes('severity') ? (
          <Select
            aria-label="Severity"
            value={values.severity ?? ''}
            onChange={(event) => onChange('severity', event.target.value || undefined)}
            placeholder="All severities"
            options={SEVERITIES.map((severity) => ({
              value: severity,
              label: severityLabels[severity],
            }))}
            containerClassName={cn(selectContainer, 'md:min-w-[8.5rem]')}
          />
        ) : null}

        {show.includes('productCategory') ? (
          <SearchableSelect
            aria-label="Product category"
            value={values.productCategory ?? ''}
            onChange={(next) => onChange('productCategory', next)}
            placeholder="All categories"
            searchPlaceholder="Find a category…"
            options={PRODUCT_CATEGORIES.map((category) => ({
              value: category,
              label: categoryLabel(category),
            }))}
            containerClassName={cn(selectContainer, 'md:min-w-[9rem]')}
          />
        ) : null}

        {showInspector ? (
          <SearchableSelect
            aria-label="Inspector"
            value={values.inspectorId ?? ''}
            onChange={(next) => onChange('inspectorId', next)}
            placeholder="All inspectors"
            searchPlaceholder="Find an inspector…"
            options={inspectors.map((inspector) => ({
              value: inspector.id,
              label: inspector.name,
            }))}
            containerClassName={cn(selectContainer, 'md:min-w-[9.5rem]')}
          />
        ) : null}

        {show.includes('state') ? (
          <SearchableSelect
            aria-label="State"
            value={values.state ?? ''}
            onChange={(next) => {
              // The chosen district may not belong to the new state, and a
              // pairing that matches nothing reads as "no records" rather than
              // as a filter that contradicts itself.
              onChange('district', undefined);
              onChange('state', next);
            }}
            placeholder="All states"
            searchPlaceholder="Find a state…"
            options={JURISDICTIONS.map((entry) => ({
              value: entry.state,
              label: entry.state,
            }))}
            containerClassName={cn(selectContainer, 'md:min-w-[8.75rem]')}
          />
        ) : null}

        {show.includes('district') ? (
          <SearchableSelect
            aria-label="District"
            value={values.district ?? ''}
            onChange={(next) => onChange('district', next)}
            placeholder={values.state ? `All of ${values.state}` : 'All districts'}
            searchPlaceholder="Find a district…"
            options={districtOptions}
            containerClassName={cn(selectContainer, 'md:min-w-[8.75rem]')}
          />
        ) : null}

        {show.includes('from') ? (
          <Select
            aria-label="Date range"
            value={values.from ?? '30'}
            onChange={(event) => onChange('from', event.target.value || undefined)}
            options={DATE_PRESETS}
            containerClassName={cn(selectContainer, 'md:min-w-[8.5rem]')}
          />
        ) : null}
      </div>

      {isFiltered ? (
        <Button variant="ghost" size="sm" icon={X} onClick={onClear} className="shrink-0">
          Clear
        </Button>
      ) : (
        <span className="hidden h-9 items-center gap-1.5 px-1 text-xs text-ink-faint md:flex">
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Filters
        </span>
      )}
    </div>
  );
}
