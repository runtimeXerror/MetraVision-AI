import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { HIT_TARGET, colors, radius, shadow, spacing, toneColors, typography } from '../constants/theme';
import type { Tone } from '../types';

/**
 * The mobile primitive set. Every screen is composed from these, which is what
 * keeps spacing, contrast and touch targets consistent in the field.
 */

/* ── Text ─────────────────────────────────────────────────────────────────── */

type Variant = keyof typeof typography;

interface TxtProps extends TextProps {
  variant?: Variant;
  color?: string;
  center?: boolean;
}

export function Txt({ variant = 'body', color, center, style, ...rest }: TxtProps) {
  return (
    <Text
      {...rest}
      style={[
        typography[variant] as TextStyle,
        { color: color ?? colors.text },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

interface CardProps extends ViewProps {
  padded?: boolean;
  /** Removes the shadow — for cards nested inside another card. */
  flat?: boolean;
}

export function Card({ padded = true, flat, style, children, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        padded && { padding: spacing.base },
        !flat && (shadow.card as ViewStyle),
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/**
 * A titled row that opens to reveal what is under it.
 *
 * The screens in this app carry a lot that an inspector must be able to reach
 * and does not need in front of them: the engine version a verdict was reached
 * under, the confidence a value was read at, the disclaimer the report is
 * issued subject to. Laid out flat, those turned the result into a wall no one
 * reads — which is worse than hiding them, because a screen that is skimmed
 * past is a screen whose warnings do not land either.
 *
 * So: one line by default, everything on tap. Nothing is removed, and the
 * count in the header says how much is folded away.
 */
export function Disclosure({
  title,
  count,
  icon,
  tone,
  defaultOpen = false,
  children,
  style,
}: {
  title: string;
  count?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Tints the row — for a disclosure that is itself a warning. */
  tone?: Tone;
  defaultOpen?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ink = tone ? toneColors[tone].fg : colors.textMuted;

  return (
    <View style={[styles.disclosure, tone && { backgroundColor: toneColors[tone].bg }, style]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.disclosureHead}
      >
        {icon ? <Ionicons name={icon} size={16} color={ink} /> : null}
        <Text style={[typography.label, { color: ink, flex: 1 }]}>
          {title}
          {count !== undefined ? ` · ${count}` : ''}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={ink} />
      </Pressable>

      {open ? <View style={styles.disclosureBody}>{children}</View> : null}
    </View>
  );
}

/** Section heading with an optional trailing action. */
export function SectionHeader({
  title,
  subtitle,
  action,
  onAction,
  style,
}: {
  title: string;
  /**
   * A qualifier on what the section contains — a window, a scope, a count.
   *
   * Worth having as a slot rather than as prose in the title: a section whose
   * contents are narrower than its heading suggests is a section that
   * misleads, and "Recent Inspections" over a list that stops at seven days is
   * exactly that.
   */
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={{ flex: 1 }}>
        <Txt variant="heading">{title}</Txt>
        {subtitle ? (
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 1 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Txt variant="label" color={colors.accent}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── Badge ────────────────────────────────────────────────────────────────── */

export function Badge({
  label,
  tone = 'neutral',
  icon,
  size = 'md',
}: {
  label: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md';
}) {
  const t = toneColors[tone];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: t.bg },
        size === 'sm' && { paddingVertical: 2, paddingHorizontal: spacing.sm },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={size === 'sm' ? 11 : 13} color={t.fg} />
      ) : (
        <View style={[styles.dot, { backgroundColor: t.dot }]} />
      )}
      <Text style={[size === 'sm' ? typography.caption : typography.label, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ── Button ───────────────────────────────────────────────────────────────── */

interface ButtonProps extends Omit<PressableProps, 'style'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading,
  fullWidth,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: colors.navy, fg: colors.textInverse, border: colors.navy },
    secondary: { bg: colors.surface, fg: colors.navy, border: colors.borderStrong },
    ghost: { bg: 'transparent', fg: colors.navy, border: 'transparent' },
    danger: { bg: colors.danger, fg: colors.textInverse, border: colors.danger },
  }[variant];

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          minHeight: size === 'lg' ? 56 : HIT_TARGET,
        },
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isDisabled && { opacity: 0.85, transform: [{ scale: 0.99 }] },
        isDisabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={19} color={palette.fg} /> : null}
          <Text style={[size === 'lg' ? typography.heading : typography.bodyStrong, { color: palette.fg }]}>
            {title}
          </Text>
          {iconRight ? <Ionicons name={iconRight} size={19} color={palette.fg} /> : null}
        </>
      )}
    </Pressable>
  );
}

/* ── States ───────────────────────────────────────────────────────────────── */

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  action,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.stateWrap}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={26} color={colors.textFaint} />
      </View>
      <Txt variant="heading" center>
        {title}
      </Txt>
      {message ? (
        <Txt variant="body" color={colors.textMuted} center style={{ marginTop: spacing.xs }}>
          {message}
        </Txt>
      ) : null}
      {action && onAction ? (
        <Button
          title={action}
          variant="secondary"
          onPress={onAction}
          style={{ marginTop: spacing.base }}
        />
      ) : null}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.stateWrap}>
      <View style={[styles.stateIcon, { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name="cloud-offline-outline" size={26} color={colors.danger} />
      </View>
      <Txt variant="heading" center>
        {title}
      </Txt>
      <Txt variant="body" color={colors.textMuted} center style={{ marginTop: spacing.xs }}>
        {message}
      </Txt>
      {onRetry ? (
        <Button
          title="Try again"
          variant="secondary"
          icon="refresh"
          onPress={onRetry}
          style={{ marginTop: spacing.base }}
        />
      ) : null}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.stateWrap}>
      <ActivityIndicator color={colors.navy} />
      <Txt variant="body" color={colors.textMuted} style={{ marginTop: spacing.md }}>
        {label}
      </Txt>
    </View>
  );
}

/** Placeholder block used while a list or card loads. */
export function Skeleton({
  height = 16,
  width = '100%',
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { height, width, backgroundColor: colors.neutralSoft, borderRadius: radius.sm },
        style,
      ]}
    />
  );
}

/* ── Layout helpers ───────────────────────────────────────────────────────── */

export function Row({
  gap = spacing.sm,
  align = 'center',
  justify,
  wrap,
  style,
  children,
}: {
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Label/value pair used across the result and detail screens. */
export function Field({
  label,
  value,
  tone,
  mono,
  missingLabel = 'Not declared',
}: {
  label: string;
  value?: string | null;
  tone?: Tone;
  mono?: boolean;
  missingLabel?: string;
}) {
  const missing = value === null || value === undefined || value === '';
  return (
    <View style={styles.field}>
      <Txt variant="overline" color={colors.textFaint}>
        {label}
      </Txt>
      <Txt
        variant={mono ? 'mono' : 'bodyStrong'}
        color={missing ? colors.danger : tone ? toneColors[tone].fg : colors.text}
        style={{ marginTop: 3 }}
      >
        {missing ? missingLabel : value}
      </Txt>
    </View>
  );
}

/** Horizontally scrolling filter chips. */
export function ChipBar<T extends string>({
  options,
  value,
  onChange,
  contentPadding = spacing.base,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  contentPadding?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: contentPadding }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && { backgroundColor: colors.navy, borderColor: colors.navy }]}
          >
            <Text style={[typography.label, { color: active ? colors.textInverse : colors.textMuted }]}>
              {option.label}
              {option.count !== undefined ? ` · ${option.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Thin horizontal meter — confidence, quality and compliance scores. */
export function Meter({
  value,
  tone = 'info',
  height = 6,
}: {
  /** 0–1. */
  value: number;
  tone?: Tone;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={[styles.meterTrack, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: toneColors[tone].fg,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  disclosure: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  disclosureHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // 48dp: the floor every touch target in this app is held to.
    minHeight: 48,
    paddingHorizontal: spacing.base,
  },
  disclosureBody: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    paddingTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  stateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  field: { paddingVertical: spacing.sm },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  meterTrack: {
    width: '100%',
    backgroundColor: colors.neutralSoft,
    overflow: 'hidden',
  },
});

/* ── Pagination ───────────────────────────────────────────────────────────── */

/**
 * Builds the page numbers to draw, with gaps marked.
 *
 * A pager that prints every page is unusable past about a dozen — on a phone it
 * wraps to three lines and the numbers shrink below a tappable size. So the
 * first page, the last page and a window around the current one are always
 * present, and everything between collapses to a gap. The first and last stay
 * because "back to the start" and "jump to the end" are the two moves an
 * inspector actually makes.
 */
export function pageWindow(current: number, total: number, span = 1): Array<number | 'gap'> {
  if (total <= 1) return [1];

  const pages = new Set<number>([1, total]);
  for (let page = current - span; page <= current + span; page += 1) {
    if (page >= 1 && page <= total) pages.add(page);
  }

  const ordered = [...pages].sort((a, b) => a - b);
  const result: Array<number | 'gap'> = [];

  ordered.forEach((page, index) => {
    const previous = ordered[index - 1];
    // A gap of exactly one page is printed as the page itself: an ellipsis
    // hiding a single number is longer than the number it hides.
    if (previous !== undefined && page - previous > 1) {
      if (page - previous === 2) result.push(previous + 1);
      else result.push('gap');
    }
    result.push(page);
  });

  return result;
}

/** Numbered pager with previous / next. */
export function Pagination({
  page,
  totalPages,
  onChange,
  disabled,
  style,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (totalPages <= 1) return null;

  const first = page <= 1;
  const last = page >= totalPages;

  return (
    <View style={[pagerStyles.pager, style]} accessibilityRole="tablist">
      <Pressable
        onPress={() => onChange(page - 1)}
        disabled={disabled || first}
        accessibilityRole="button"
        accessibilityLabel="Previous page"
        accessibilityState={{ disabled: disabled || first }}
        style={({ pressed }) => [
          pagerStyles.pageStep,
          pressed && !first && { backgroundColor: colors.surfaceAlt },
          (disabled || first) && { opacity: 0.35 },
        ]}
      >
        <Ionicons name="chevron-back" size={16} color={colors.navy} />
        <Text style={[typography.label, { color: colors.navy }]}>Prev</Text>
      </Pressable>

      <Row gap={4} style={{ flex: 1, justifyContent: 'center' }}>
        {pageWindow(page, totalPages).map((entry, index) =>
          entry === 'gap' ? (
            <View key={`gap-${index}`} style={pagerStyles.pageGap}>
              <Text style={[typography.label, { color: colors.textFaint }]}>…</Text>
            </View>
          ) : (
            <Pressable
              key={entry}
              onPress={() => onChange(entry)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Page ${entry}`}
              accessibilityState={{ selected: entry === page, disabled }}
              style={({ pressed }) => [
                pagerStyles.pageNumber,
                entry === page && { backgroundColor: colors.navy, borderColor: colors.navy },
                pressed && entry !== page && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Text
                style={[
                  typography.label,
                  { color: entry === page ? colors.textInverse : colors.text },
                ]}
              >
                {entry}
              </Text>
            </Pressable>
          ),
        )}
      </Row>

      <Pressable
        onPress={() => onChange(page + 1)}
        disabled={disabled || last}
        accessibilityRole="button"
        accessibilityLabel="Next page"
        accessibilityState={{ disabled: disabled || last }}
        style={({ pressed }) => [
          pagerStyles.pageStep,
          pressed && !last && { backgroundColor: colors.surfaceAlt },
          (disabled || last) && { opacity: 0.35 },
        ]}
      >
        <Text style={[typography.label, { color: colors.navy }]}>Next</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.navy} />
      </Pressable>
    </View>
  );
}

const pagerStyles = StyleSheet.create({
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  pageStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: HIT_TARGET - 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  pageNumber: {
    minWidth: HIT_TARGET - 12,
    height: HIT_TARGET - 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageGap: {
    minWidth: 18,
    height: HIT_TARGET - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
