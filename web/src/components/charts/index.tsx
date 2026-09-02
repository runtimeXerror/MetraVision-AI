import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useIsNarrow } from '@/hooks';
import type {
  CategoryBar,
  DistributionSlice,
  TrendPoint,
  ViolationTypeBar,
} from '@/types/api';
import { categoryLabel, formatAxisDate, formatDate, formatNumber } from '@/utils/format';

/**
 * Charts.
 *
 * Three rules hold across all of them, and they are why these live in one file
 * rather than being assembled per page:
 *
 *  1. A verdict is always the same colour. Compliant is green wherever it
 *     appears; a chart that recolours it by series makes the dashboard lie.
 *  2. Colours come from the theme tokens, so the charts follow light/dark
 *     rather than keeping a hardcoded palette that vanishes on a dark surface.
 *  3. Every series is labelled in the tooltip. A stacked area no one can read
 *     the components of is decoration.
 */

/**
 * Recharts needs concrete colour values, not CSS variables, because it writes
 * them into SVG attributes. Reading the computed custom properties keeps the
 * charts on the same palette as everything else — and re-reading on theme
 * change is why `useThemeColors` exists rather than a module constant.
 */
import { useEffect, useState } from 'react';

import { useUiStore } from '@/store/uiStore';

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `hsl(${value})` : fallback;
}

interface ChartColors {
  compliant: string;
  violation: string;
  review: string;
  brand: string;
  neutral: string;
  info: string;
  grid: string;
  axis: string;
  surface: string;
  ink: string;
  line: string;
}

function useThemeColors(): ChartColors {
  const theme = useUiStore((state) => state.theme);
  const [colors, setColors] = useState<ChartColors>(() => read());

  function read(): ChartColors {
    return {
      compliant: readVar('--compliant', 'hsl(158 64% 36%)'),
      violation: readVar('--violation', 'hsl(0 72% 48%)'),
      review: readVar('--review', 'hsl(32 95% 44%)'),
      brand: readVar('--brand', 'hsl(224 71% 45%)'),
      neutral: readVar('--neutral-state', 'hsl(215 16% 47%)'),
      info: readVar('--info', 'hsl(199 89% 42%)'),
      grid: readVar('--line', 'hsl(214 32% 91%)'),
      axis: readVar('--ink-faint', 'hsl(215 16% 57%)'),
      surface: readVar('--surface', 'hsl(0 0% 100%)'),
      ink: readVar('--ink', 'hsl(222 47% 11%)'),
      line: readVar('--line', 'hsl(214 32% 91%)'),
    };
  }

  // The custom properties change with the `dark` class, so re-read after it flips.
  useEffect(() => {
    setColors(read());
  }, [theme]);

  return colors;
}

/** Shared tooltip chrome, so every chart's hover looks like the same product. */
function tooltipStyle(colors: ChartColors) {
  return {
    contentStyle: {
      background: colors.surface,
      border: `1px solid ${colors.line}`,
      borderRadius: '0.625rem',
      boxShadow: '0 12px 32px -8px rgb(0 0 0 / 0.18)',
      fontSize: '0.75rem',
      padding: '0.5rem 0.75rem',
    },
    labelStyle: { color: colors.ink, fontWeight: 600, marginBottom: '0.25rem' },
    itemStyle: { padding: '0.0625rem 0' },
  };
}

const AXIS = { fontSize: 11, fontWeight: 500 };

/* ── Inspection trend ─────────────────────────────────────────────────────── */

export function TrendChart({ data, height = 280 }: { data: TrendPoint[]; height?: number }) {
  const colors = useThemeColors();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-compliant" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.compliant} stopOpacity={0.28} />
            <stop offset="100%" stopColor={colors.compliant} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="grad-violation" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.violation} stopOpacity={0.28} />
            <stop offset="100%" stopColor={colors.violation} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="grad-review" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.review} stopOpacity={0.28} />
            <stop offset="100%" stopColor={colors.review} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="date"
          tickFormatter={formatAxisDate}
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={{ stroke: colors.grid }}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={42}
        />
        <Tooltip
          {...tooltipStyle(colors)}
          labelFormatter={(value: string) => formatDate(value)}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: '0.6875rem', paddingTop: '0.5rem' }}
        />

        {/* Stacked, because the three verdicts partition the day's work —
            overlaying them would imply they can exceed the total. */}
        <Area
          type="monotone"
          dataKey="compliant"
          name="Compliant"
          stackId="1"
          stroke={colors.compliant}
          strokeWidth={2}
          fill="url(#grad-compliant)"
        />
        <Area
          type="monotone"
          dataKey="violations"
          name="Violation"
          stackId="1"
          stroke={colors.violation}
          strokeWidth={2}
          fill="url(#grad-violation)"
        />
        <Area
          type="monotone"
          dataKey="reviewRequired"
          name="Review required"
          stackId="1"
          stroke={colors.review}
          strokeWidth={2}
          fill="url(#grad-review)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Compliance distribution ──────────────────────────────────────────────── */

const DISTRIBUTION_LABELS: Record<string, string> = {
  COMPLIANT: 'Compliant',
  VIOLATION_DETECTED: 'Violation',
  REVIEW_REQUIRED: 'Review required',
  NOT_ASSESSED: 'Not assessed',
};

export function DistributionChart({
  data,
  height = 260,
}: {
  data: DistributionSlice[];
  height?: number;
}) {
  const colors = useThemeColors();

  const toneFor: Record<string, string> = {
    COMPLIANT: colors.compliant,
    VIOLATION_DETECTED: colors.violation,
    REVIEW_REQUIRED: colors.review,
    NOT_ASSESSED: colors.neutral,
  };

  // Empty slices would render as invisible wedges with a legend entry.
  const slices = data.filter((slice) => slice.count > 0);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);

  if (total === 0) {
    return (
      <div style={{ height }} className="grid place-items-center text-sm text-ink-muted">
        No assessed inspections in this range.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="count"
          nameKey="status"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {slices.map((slice) => (
            <Cell key={slice.status} fill={toneFor[slice.status] ?? colors.neutral} />
          ))}
        </Pie>
        <Tooltip
          {...tooltipStyle(colors)}
          formatter={(value: number, name: string) => [
            `${formatNumber(value)} (${Math.round((value / total) * 100)}%)`,
            DISTRIBUTION_LABELS[name] ?? name,
          ]}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          formatter={(value: string) => DISTRIBUTION_LABELS[value] ?? value}
          wrapperStyle={{ fontSize: '0.6875rem' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ── Violations by category ───────────────────────────────────────────────── */

export function CategoryChart({ data, height = 280 }: { data: CategoryBar[]; height?: number }) {
  const colors = useThemeColors();
  const narrow = useIsNarrow();
  const rows = data.map((row) => ({ ...row, label: categoryLabel(row.category) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* The negative left margin reclaims Recharts' axis padding; a leaning
          label on a phone needs that space back or it runs off the edge. */}
      <BarChart
        data={rows}
        margin={{ top: 8, right: 8, left: narrow ? 4 : -18, bottom: 0 }}
        barGap={4}
      >
        <XAxis
          dataKey="label"
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={{ stroke: colors.grid }}
          tickLine={false}
          interval={0}
          // Every category is labelled, so on a phone the labels have to lean
          // further over and give up characters rather than overprint.
          angle={narrow ? -38 : -14}
          textAnchor="end"
          height={narrow ? 76 : 54}
          tickFormatter={(value: string) =>
            narrow && value.length > 11 ? `${value.slice(0, 10)}…` : value
          }
        />
        <YAxis
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={42}
        />
        <Tooltip {...tooltipStyle(colors)} cursor={{ fill: colors.grid, opacity: 0.35 }} />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: '0.6875rem' }} />

        {/* Both series, because violations alone cannot be read: four findings
            out of five inspections and four out of four hundred are different
            facts. */}
        <Bar dataKey="inspections" name="Inspections" fill={colors.brand} radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="violations" name="Violations" fill={colors.violation} radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Common violation types ───────────────────────────────────────────────── */

export function ViolationTypeChart({
  data,
  height = 280,
}: {
  data: ViolationTypeBar[];
  height?: number;
}) {
  const colors = useThemeColors();
  const narrow = useIsNarrow();

  const severityColor: Record<string, string> = {
    CRITICAL: colors.violation,
    MAJOR: colors.review,
    MINOR: colors.neutral,
  };

  // 168px of axis leaves a phone almost no room for the bars themselves.
  const axisWidth = narrow ? 104 : 168;
  const labelLimit = narrow ? 16 : 26;

  // Horizontal: these labels are sentences ("Consumer Care Details not
  // declared") and would be unreadable rotated under a vertical axis.
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
      >
        <XAxis
          type="number"
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="title"
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          width={axisWidth}
          tickFormatter={(value: string) =>
            value.length > labelLimit ? `${value.slice(0, labelLimit - 1)}…` : value
          }
        />
        <Tooltip
          {...tooltipStyle(colors)}
          cursor={{ fill: colors.grid, opacity: 0.35 }}
          formatter={(value: number) => [formatNumber(value), 'Findings']}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {data.map((row) => (
            <Cell key={row.code} fill={severityColor[row.severity] ?? colors.neutral} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Inspector activity ───────────────────────────────────────────────────── */

export function InspectorChart({
  data,
  height = 260,
}: {
  data: Array<{ name: string; totalInspections: number; violations: number }>;
  height?: number;
}) {
  const colors = useThemeColors();

  // Surnames alone: the axis has room for one word, and the full name is in the
  // table directly beneath this chart.
  const rows = data.map((row) => ({
    ...row,
    short: row.name.split(' ').slice(-1)[0] ?? row.name,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={4}>
        <XAxis
          dataKey="short"
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={{ stroke: colors.grid }}
          tickLine={false}
        />
        <YAxis
          tick={{ ...AXIS, fill: colors.axis }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={42}
        />
        <Tooltip {...tooltipStyle(colors)} cursor={{ fill: colors.grid, opacity: 0.35 }} />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: '0.6875rem' }} />
        <Bar dataKey="totalInspections" name="Inspections" fill={colors.brand} radius={[4, 4, 0, 0]} maxBarSize={30} />
        <Bar dataKey="violations" name="Violations" fill={colors.violation} radius={[4, 4, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
}
