import { Check, ChevronDown, Search, X, type LucideIcon } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { cn } from '@/utils/cn';

/**
 * Form controls.
 *
 * Kept apart from the presentational primitives because these own focus and
 * validation state. Every one of them takes a `label` — an unlabelled control
 * in a government tool is an accessibility defect, not a style choice.
 */

const CONTROL =
  'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors hover:border-ink-faint ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: LucideIcon;
  containerClassName?: string;
}

export function Input({
  label,
  error,
  hint,
  icon: Icon,
  containerClassName,
  className,
  id,
  ...rest
}: InputProps) {
  const generated = React.useId();
  const inputId = id ?? generated;

  return (
    <div className={cn('w-full', containerClassName)}>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-ink-muted">
          {label}
        </label>
      ) : null}

      <div className="relative">
        {Icon ? (
          <Icon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            strokeWidth={2}
            aria-hidden
          />
        ) : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={cn(CONTROL, Icon && 'pl-9', error && 'border-violation', className)}
          {...rest}
        />
      </div>

      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-violation">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Textarea({
  label,
  error,
  className,
  id,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  const generated = React.useId();
  const fieldId = id ?? generated;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-ink-muted">
          {label}
        </label>
      ) : null}
      <textarea
        id={fieldId}
        className={cn(CONTROL, 'h-auto min-h-[5rem] py-2 leading-relaxed', error && 'border-violation', className)}
        {...rest}
      />
      {error ? <p className="mt-1 text-xs text-violation">{error}</p> : null}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A native select, styled.
 *
 * Deliberately not a custom listbox: the native control gives keyboard
 * behaviour, type-ahead and mobile pickers for free, and none of the filters
 * here need multi-select or rich option content.
 */
export function Select({
  label,
  options,
  placeholder,
  className,
  containerClassName,
  id,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
}) {
  const generated = React.useId();
  const selectId = id ?? generated;

  return (
    <div className={cn('w-full', containerClassName)}>
      {label ? (
        <label htmlFor={selectId} className="mb-1.5 block text-xs font-medium text-ink-muted">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={selectId}
          className={cn(CONTROL, 'appearance-none pr-9', className)}
          {...rest}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          strokeWidth={2}
          aria-hidden
        />
      </div>
    </div>
  );
}

/**
 * A select you can type into.
 *
 * The native control is still the right answer for a short, fixed list — see
 * `Select` above. This one exists for the lists that grow with the data:
 * categories, the inspector roster, states, districts. Once a list is longer
 * than a glance, scanning it is slower than typing three letters of it.
 *
 * Options are sorted alphabetically and the popover is capped at five rows,
 * scrolling beyond that, so the control stays the same height whether it is
 * offering three districts or three hundred.
 */
export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'All',
  searchPlaceholder = 'Type to filter…',
  containerClassName,
  'aria-label': ariaLabel,
}: {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string | undefined) => void;
  /** Shown when nothing is chosen, and as the row that clears the filter. */
  placeholder?: string;
  searchPlaceholder?: string;
  containerClassName?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');
  const [active, setActive] = React.useState(0);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const sorted = React.useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label)),
    [options],
  );

  const matches = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((option) => option.label.toLowerCase().includes(needle));
  }, [sorted, term]);

  // The clear row counts as a row, so the highlight index spans both.
  const rows: Array<SelectOption | null> = [null, ...matches];
  const selected = sorted.find((option) => option.value === value);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (open) searchRef.current?.focus();
    else {
      setTerm('');
      setActive(0);
    }
  }, [open]);

  // Keeps the highlighted row inside the five-row window.
  React.useEffect(() => {
    const list = listRef.current;
    const row = list?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(option: SelectOption | null) {
    onChange(option?.value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[active] ?? null);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={cn('relative w-full', containerClassName)} ref={containerRef}>
      {label ? (
        <span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</span>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(CONTROL, 'flex items-center justify-between gap-2 pr-3 text-left')}
      >
        <span className={cn('truncate', !selected && 'text-ink-faint')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-full animate-fade-up overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <div className="border-b border-line p-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
                strokeWidth={2}
                aria-hidden
              />
              <input
                ref={searchRef}
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                aria-label={ariaLabel ? `Filter ${ariaLabel}` : 'Filter options'}
                className={cn(
                  'h-8 w-full rounded-md border border-line bg-surface-sunken pl-7 pr-2 text-xs text-ink',
                  'placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none',
                )}
              />
            </div>
          </div>

          {/* Five rows at 2rem each; anything longer scrolls rather than
              growing a popover taller than the page. */}
          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            className="scroll-slim max-h-[10rem] overflow-y-auto py-1"
          >
            {rows.length === 1 && matches.length === 0 && term ? (
              <p className="px-3 py-3 text-center text-xs text-ink-muted">
                Nothing matches “{term}”.
              </p>
            ) : null}

            {rows.map((option, index) => {
              const isSelected = option ? option.value === value : !value;

              return (
                <button
                  key={option?.value ?? '__all'}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex h-8 w-full items-center justify-between gap-2 px-3 text-left text-xs transition-colors',
                    index === active ? 'bg-surface-sunken text-ink' : 'text-ink-muted',
                    isSelected && 'font-semibold text-ink',
                  )}
                >
                  <span className="truncate">{option ? option.label : placeholder}</span>
                  {isSelected ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} aria-hidden />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Debounced search box.
 *
 * The debounce lives here rather than in each page: every list in the console
 * searches server-side, and a keystroke-per-request would put a regex scan on
 * the database for every letter typed.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  delay = 300,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  delay?: number;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Adopt an externally cleared value (the "clear filters" button).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local === value) return;
    const timer = setTimeout(() => onChangeRef.current(local), delay);
    return () => clearTimeout(timer);
  }, [local, value, delay]);

  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
        strokeWidth={2}
        aria-hidden
      />
      <input
        type="search"
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(CONTROL, 'pl-9 pr-9')}
      />
      {local ? (
        <button
          type="button"
          onClick={() => {
            setLocal('');
            onChangeRef.current('');
          }}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-ink-faint hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

/** Segmented control, for small mutually-exclusive choices. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex rounded-lg border border-line-strong bg-surface-sunken p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            option.value === value
              ? 'bg-surface text-ink shadow-sm'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
