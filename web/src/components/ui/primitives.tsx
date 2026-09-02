import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import React from 'react';

import { cn } from '@/utils/cn';

/**
 * Presentational primitives.
 *
 * Deliberately hand-built rather than pulled from a component library: this is
 * a small, opinionated surface — cards, tables, badges, buttons — and owning it
 * means the enforcement vocabulary (a verdict, a severity, a confidence) is
 * expressed once, in a component whose name says what it means.
 *
 * None of these hold server state or perform I/O.
 */

/* ── Surface ──────────────────────────────────────────────────────────────── */

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface shadow-card',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink sm:truncate">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

/* ── Page scaffolding ─────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/* ── Button ───────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-sunken',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-violation text-white hover:brightness-95 shadow-sm',
  subtle: 'bg-brand-soft text-brand hover:brightness-95',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
      ) : null}
      {children}
      {IconRight && !loading ? (
        <IconRight className="h-4 w-4" strokeWidth={2} aria-hidden />
      ) : null}
    </button>
  );
}

/* ── Badge ────────────────────────────────────────────────────────────────── */

type Tone = 'compliant' | 'violation' | 'review' | 'neutral' | 'info' | 'brand';

const TONES: Record<Tone, string> = {
  compliant: 'bg-compliant-soft text-compliant-ink ring-compliant/25',
  violation: 'bg-violation-soft text-violation-ink ring-violation/25',
  review: 'bg-review-soft text-review-ink ring-review/25',
  neutral: 'bg-neutralState-soft text-neutralState-ink ring-neutralState/20',
  info: 'bg-info-soft text-info-ink ring-info/25',
  brand: 'bg-brand-soft text-brand ring-brand/20',
};

const DOTS: Record<Tone, string> = {
  compliant: 'bg-compliant',
  violation: 'bg-violation',
  review: 'bg-review',
  neutral: 'bg-neutralState',
  info: 'bg-info',
  brand: 'bg-brand',
};

export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
}: {
  tone?: Tone;
  /** Adds a status dot, so the meaning is not carried by colour alone. */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5',
        'text-2xs font-semibold uppercase tracking-wide ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone])} aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ── Field display ────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A definition row, used throughout the detail pages.
 *
 * The side-by-side layout spends 11rem on the label, which only pays off in a
 * full-width card. `stacked` keeps the label above the value at every width —
 * for a card in a narrow grid column, where sharing the row leaves the value
 * too little room to hold a date or a badge on one line.
 */
export function DetailRow({
  label,
  children,
  mono,
  stacked,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  /** Keeps label above value regardless of viewport — for narrow containers. */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 border-b border-line py-2.5 last:border-0',
        !stacked && 'sm:flex-row sm:gap-4',
      )}
    >
      <dt className={cn('shrink-0 text-xs font-medium text-ink-muted', !stacked && 'w-44')}>
        {label}
      </dt>
      <dd className={cn('min-w-0 flex-1 text-sm text-ink', mono && 'font-mono tabular')}>
        {children}
      </dd>
    </div>
  );
}

/* ── Confidence ───────────────────────────────────────────────────────────── */

/**
 * A confidence reading, shown as a bar and a number.
 *
 * The threshold at 75% matches the backend's `REVIEW_CONFIDENCE_THRESHOLD`: a
 * field below it is what routes an inspection to human review, so the bar
 * changes colour at exactly the point the workflow does.
 */
export function ConfidenceBar({
  value,
  className,
  showValue = true,
}: {
  value: number;
  className?: string;
  showValue?: boolean;
}) {
  const percent = Math.round(value * 100);
  const tone = value >= 0.9 ? 'bg-compliant' : value >= 0.75 ? 'bg-info' : 'bg-review';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 w-full min-w-[3rem] overflow-hidden rounded-full bg-line"
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Extraction confidence"
      >
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${percent}%` }} />
      </div>
      {showValue ? (
        <span className="w-9 shrink-0 text-right text-xs font-medium tabular text-ink-muted">
          {percent}%
        </span>
      ) : null}
    </div>
  );
}

/* ── Misc ─────────────────────────────────────────────────────────────────── */

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-t border-line', className)} />;
}

export function Avatar({
  name,
  color,
  size = 36,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  const monogram = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color || 'hsl(var(--brand))',
        fontSize: size * 0.36,
      }}
      aria-hidden
    >
      {monogram || '?'}
    </span>
  );
}

/** Non-blocking disclosure strip. Used for the mock-analysis notice. */
export function Notice({
  tone = 'info',
  icon: Icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-xs leading-relaxed ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
