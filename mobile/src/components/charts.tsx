import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '../constants/theme';
import { Row, Txt } from './ui';

/**
 * ── CHART PRIMITIVES ────────────────────────────────────────────────────────
 * Plain views, no charting library. Three rules carry through all of them:
 *
 *   1. **Colour never carries meaning alone.** Every fill is paired with a
 *      label, and the status fills are paired with an icon as well, so a
 *      colour-blind inspector reads the same figures as anyone else.
 *   2. **White does the separating.** Touching marks are held apart by a 2px
 *      gap in the surface colour, never by a stroke — a border adds ink that
 *      is not data.
 *   3. **Text wears text tokens.** Bars carry the colour; the numbers beside
 *      them stay in ink, because a mid-tone fill is illegible as type.
 *
 * The stack order in `StackedShareBar` is deliberate and load-bearing: the
 * amber "review required" fill and the red "violation" fill are only ΔE 10
 * apart to a normal-sighted reader, which is not enough to tell two touching
 * segments apart. Seating the green between them lifts the worst adjacent pair
 * to ΔE 20. Re-order the segments and that guarantee is gone.
 * ────────────────────────────────────────────────────────────────────────────
 */

const SURFACE_GAP = 2;

/* ── Part-to-whole ────────────────────────────────────────────────────────── */

export interface ShareSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

/**
 * Horizontal part-to-whole bar.
 *
 * Chosen over a donut because a phone gives this ~320pt of width and ~40pt of
 * height: a bar spends that budget on the comparison, a donut spends it on a
 * hole. A segment worth a fraction of a percent still renders at a visible
 * minimum, so a single violation in a busy month cannot vanish from the picture.
 */
export function StackedShareBar({
  segments,
  height = 14,
  style,
}: {
  segments: ShareSegment[];
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const present = segments.filter((segment) => segment.value > 0);
  const total = present.reduce((sum, segment) => sum + segment.value, 0);
  const r = height / 2;

  if (total === 0) {
    return <View style={[styles.emptyTrack, { height, borderRadius: r }, style]} />;
  }

  return (
    <View style={[{ flexDirection: 'row', gap: SURFACE_GAP }, style]}>
      {present.map((segment, index) => {
        const first = index === 0;
        const last = index === present.length - 1;
        return (
          <View
            key={segment.key}
            accessibilityLabel={`${segment.label}: ${segment.value}`}
            style={{
              flexGrow: segment.value,
              flexShrink: 1,
              flexBasis: 0,
              // A hair of guaranteed width, so a segment of one never disappears.
              minWidth: 3,
              height,
              backgroundColor: segment.color,
              borderTopLeftRadius: first ? r : 0,
              borderBottomLeftRadius: first ? r : 0,
              borderTopRightRadius: last ? r : 0,
              borderBottomRightRadius: last ? r : 0,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * The identity channel for the bar above.
 *
 * Always rendered beside a `StackedShareBar` — the bar shows proportion, this
 * shows which is which, and the count, and the share. Never ship one without
 * the other.
 */
export function ShareLegend({
  segments,
  style,
}: {
  segments: ShareSegment[];
  style?: StyleProp<ViewStyle>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <View style={style}>
      {segments.map((segment, index) => (
        <Row key={segment.key} gap={spacing.sm} style={{ marginTop: index === 0 ? 0 : spacing.sm }}>
          {segment.icon ? (
            <Ionicons name={segment.icon} size={14} color={segment.color} />
          ) : (
            <View style={[styles.swatch, { backgroundColor: segment.color }]} />
          )}
          <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }} numberOfLines={1}>
            {segment.label}
          </Txt>
          <Txt variant="bodyStrong">{segment.value}</Txt>
          <Txt variant="caption" color={colors.textFaint} style={styles.shareCell}>
            {total > 0 ? `${Math.round((segment.value / total) * 100)}%` : '—'}
          </Txt>
        </Row>
      ))}
    </View>
  );
}

/* ── Change over time ─────────────────────────────────────────────────────── */

export interface ColumnPoint {
  key: string;
  /** Shown under the axis — only the first, middle and last are drawn. */
  label: string;
  total: number;
  /** The part of `total` that carried a violation. Never exceeds it. */
  violations: number;
}

/**
 * Enforcement activity over the selected window.
 *
 * Two segments that *partition* the total — inspections that raised a finding,
 * and those that did not. Plotting "violations" as a second full-height series
 * beside "total" would count the same records twice and overstate the volume.
 */
export function ColumnChart({
  points,
  caption = 'Inspections per day',
  height = 104,
  style,
}: {
  points: ColumnPoint[];
  caption?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const max = points.reduce((peak, point) => Math.max(peak, point.total), 0);

  if (points.length === 0 || max === 0) {
    return (
      <View style={[{ height: height + 20, justifyContent: 'center' }, style]}>
        <Txt variant="caption" color={colors.textFaint} center>
          No inspections recorded in this period.
        </Txt>
      </View>
    );
  }

  const lastIndex = points.length - 1;
  const midIndex = Math.floor(lastIndex / 2);

  return (
    <View style={style}>
      {/* The peak is direct-labelled and the y-axis dropped entirely: with the
          one extreme labelled, gridlines would be ink for a value the reader
          already has. */}
      <Row justify="space-between" style={{ marginBottom: spacing.sm }}>
        <Txt variant="overline" color={colors.textFaint}>
          {caption}
        </Txt>
        <Txt variant="caption" color={colors.textMuted}>
          Peak {max}
        </Txt>
      </Row>

      <View style={[styles.plot, { height }]}>
        {points.map((point) => {
          const full = point.total > 0 ? Math.max((point.total / max) * height, 3) : 0;
          const violations = point.total > 0 ? (point.violations / point.total) * full : 0;
          const clear = Math.max(full - violations, 0);
          const stacked = violations > 0 && clear > 0;

          return (
            <View
              key={point.key}
              accessibilityLabel={`${point.label}: ${point.total} inspections, ${point.violations} with a violation`}
              style={styles.column}
            >
              {clear > 0 ? (
                <View
                  style={{
                    width: '100%',
                    height: stacked ? Math.max(clear - SURFACE_GAP, 1) : clear,
                    marginBottom: stacked ? SURFACE_GAP : 0,
                    backgroundColor: colors.navySoft,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                  }}
                />
              ) : null}
              {violations > 0 ? (
                <View
                  style={{
                    width: '100%',
                    height: violations,
                    backgroundColor: colors.danger,
                    borderTopLeftRadius: clear > 0 ? 0 : 4,
                    borderTopRightRadius: clear > 0 ? 0 : 4,
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.baseline} />

      <Row justify="space-between" style={{ marginTop: spacing.xs }}>
        <Txt variant="caption" color={colors.textFaint}>
          {points[0]?.label}
        </Txt>
        {points.length > 2 ? (
          <Txt variant="caption" color={colors.textFaint}>
            {points[midIndex]?.label}
          </Txt>
        ) : null}
        <Txt variant="caption" color={colors.textFaint}>
          {points[lastIndex]?.label}
        </Txt>
      </Row>

      <Row gap={spacing.base} wrap style={{ marginTop: spacing.md }}>
        <LegendKey color={colors.navySoft} label="No violation found" />
        <LegendKey color={colors.danger} label="Violation found" />
      </Row>
    </View>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <Row gap={spacing.xs}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Txt variant="caption" color={colors.textMuted}>
        {label}
      </Txt>
    </Row>
  );
}

/* ── Magnitude ────────────────────────────────────────────────────────────── */

export interface BarRow {
  key: string;
  label: string;
  /** Context under the label — the rule cited, or the volume inspected. */
  sublabel?: string;
  value: number;
  /** Overrides the default fill. For a status reading, never for variety. */
  color?: string;
}

/**
 * Ranked horizontal bars.
 *
 * One hue for every row: the ranking is already carried by length and by
 * position, so colouring each bar differently would invent an identity the data
 * does not have. Bars run to the widest value in the set rather than to a round
 * number — the question here is "which of these is worst", not "how close to a
 * target".
 */
export function BarList({
  rows,
  emptyMessage = 'Nothing recorded in this period.',
  style,
}: {
  rows: BarRow[];
  emptyMessage?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.value), 0);

  if (rows.length === 0 || max === 0) {
    return (
      <Txt variant="caption" color={colors.textFaint} style={style}>
        {emptyMessage}
      </Txt>
    );
  }

  return (
    <View style={style}>
      {rows.map((row, index) => (
        <View key={row.key} style={{ marginTop: index === 0 ? 0 : spacing.base }}>
          <Row justify="space-between" gap={spacing.sm}>
            <Txt variant="label" style={{ flex: 1 }} numberOfLines={2}>
              {row.label}
            </Txt>
            <Txt variant="bodyStrong">{row.value}</Txt>
          </Row>

          {row.sublabel ? (
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
              {row.sublabel}
            </Txt>
          ) : null}

          <View style={styles.barTrack}>
            <View
              accessibilityLabel={`${row.label}: ${row.value}`}
              style={{
                width: `${Math.max((row.value / max) * 100, 2)}%`,
                height: '100%',
                borderRadius: 4,
                backgroundColor: row.color ?? colors.accent,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyTrack: { backgroundColor: colors.neutralSoft },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  shareCell: { width: 34, textAlign: 'right' },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    // Keeps the series spanning the full axis. With the marks capped below,
    // the leftover would otherwise collect on the right and the columns would
    // stop short of the last date label they are supposed to meet.
    justifyContent: 'space-between',
    gap: SURFACE_GAP,
  },
  // `maxWidth` caps the mark so a short window draws bars, not blocks — the
  // leftover band width is deliberate air.
  column: { flex: 1, maxWidth: 24, justifyContent: 'flex-end' },
  baseline: { height: 1, backgroundColor: colors.border },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.neutralSoft,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
});
