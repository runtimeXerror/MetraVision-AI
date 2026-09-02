import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HIT_TARGET, colors, radius, spacing } from '../constants/theme';

import { Row, Txt } from './ui';

/**
 * Screen scaffolding — headers, safe areas and the step indicator used by the
 * multi-step inspection flow.
 */

/** Standard page wrapper: safe area + background. */
export function Screen({
  children,
  style,
  edges = ['top'],
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: Array<'top' | 'bottom' | 'left' | 'right'>;
}) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

/**
 * Screen header.
 *
 * `onBack` is passed explicitly rather than read from navigation so the same
 * header works on a stack screen, a tab root and inside a modal.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Row align="center" gap={spacing.sm} style={[styles.header, style]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.navy} />
        </Pressable>
      ) : null}

      <View style={{ flex: 1 }}>
        <Txt variant="title" numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>

      {right}
    </Row>
  );
}

/** Navy banner used at the top of Home and the auth screens. */
export function HeroHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.hero, { paddingTop: insets.top + spacing.base }, style]}>{children}</View>
  );
}

/**
 * Progress indicator for the capture flow.
 *
 * Numbered rather than a bare progress bar: an inspector interrupted mid-flow
 * needs to know which step they are on, not just how far along they are.
 */
export function StepIndicator({
  steps,
  current,
}: {
  steps: string[];
  /** Zero-based index of the active step. */
  current: number;
}) {
  return (
    <View style={styles.steps}>
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <View key={label} style={styles.step}>
            {/*
              The dot sits centred in its own column, with half a connector on
              each side of it.

              Previously each step laid out as [dot][line] left-aligned, and the
              last step drew no line at all — so "Result" reserved a full empty
              column, the dots crept leftward, and the first label sat hard
              against the screen edge while a fifth of the width went unused on
              the right. Splitting the connector in two and centring the dot
              distributes all five evenly, and the end caps are simply hidden.
            */}
            <View style={styles.stepTrack}>
              <View
                style={[
                  styles.stepLine,
                  // The run into this step is complete once the step before it
                  // is, which is what puts the fill up to the active dot.
                  index <= current && { backgroundColor: colors.success },
                  // Last, so it wins: a later entry in a RN style array
                  // overrides an earlier one, and with the fill after it the
                  // hidden end cap would be painted green on the first step.
                  index === 0 && styles.stepLineHidden,
                ]}
              />

              <View
                style={[
                  styles.stepDot,
                  done && { backgroundColor: colors.success, borderColor: colors.success },
                  active && { backgroundColor: colors.navy, borderColor: colors.navy },
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={12} color={colors.textInverse} />
                ) : (
                  <Txt
                    variant="caption"
                    color={active ? colors.textInverse : colors.textFaint}
                    style={{ fontSize: 11 }}
                  >
                    {index + 1}
                  </Txt>
                )}
              </View>

              <View
                style={[
                  styles.stepLine,
                  done && { backgroundColor: colors.success },
                  // Last, for the same reason as above.
                  index === steps.length - 1 && styles.stepLineHidden,
                ]}
              />
            </View>

            <Txt
              variant="caption"
              color={active ? colors.navy : colors.textFaint}
              numberOfLines={1}
              style={styles.stepLabel}
            >
              {label}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Sticky action bar pinned to the bottom of a flow screen.
 *
 * Respects the home-indicator inset so the primary action is never clipped.
 */
export function ActionBar({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, spacing.base) }]}>
      {children}
    </View>
  );
}

/** Scrollable body with consistent padding, sized to clear a sticky ActionBar. */
export function Body({
  children,
  padded = true,
  contentStyle,
  refreshControl,
}: {
  children: React.ReactNode;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        padded && { paddingHorizontal: spacing.base },
        { paddingBottom: spacing.xxl },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/**
 * Non-blocking notice strip. Used for the mock-analysis disclosure and for
 * inline warnings that must not be mistaken for a verdict.
 */
export function Notice({
  icon = 'information-circle-outline',
  text,
  tone = 'info',
  style,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  text: string;
  tone?: 'info' | 'warning';
  style?: StyleProp<ViewStyle>;
}) {
  const bg = tone === 'warning' ? colors.warningSoft : colors.infoSoft;
  const fg = tone === 'warning' ? colors.warning : colors.info;

  return (
    <Row align="flex-start" gap={spacing.sm} style={[styles.notice, { backgroundColor: bg }, style]}>
      <Ionicons name={icon} size={16} color={fg} style={{ marginTop: 1 }} />
      <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
        {text}
      </Txt>
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: HIT_TARGET - 8,
    height: HIT_TARGET - 8,
    marginLeft: -spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  steps: {
    flexDirection: 'row',
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
  },
  /** Equal columns, dot and label centred in each. */
  step: { flex: 1, alignItems: 'center' },
  /** The connector row: half-line, dot, half-line — stretched to the column. */
  stepTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLabel: { marginTop: 6, fontSize: 10, textAlign: 'center' },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLine: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.border,
  },
  /**
   * The outer halves of the first and last connectors.
   *
   * Kept in the tree rather than removed, so every column stays the same width
   * and the dots remain evenly spaced — dropping them would pull the end dots
   * inward and reintroduce the lopsidedness this layout exists to fix.
   */
  stepLineHidden: { backgroundColor: 'transparent' },
  actionBar: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
  },
});
