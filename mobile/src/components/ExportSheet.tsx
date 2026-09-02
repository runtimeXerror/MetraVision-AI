import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, HIT_TARGET, radius, shadow, spacing, typography } from '../constants/theme';

import { Txt } from './ui';

/**
 * ── THE EXPORT SHEET ────────────────────────────────────────────────────────
 *
 * Replaces the three-button `Alert.alert` that used to ask where a PDF should
 * go. The alert worked, but it asked the question badly: two labels — "Save to
 * device" and "Share" — with nothing to say what either one actually does, in a
 * dialog that looks identical to the one reporting a failure. On Android the
 * three buttons crushed onto one line and read as a warning rather than a
 * choice.
 *
 * What an inspector needs at that moment is not fewer words but the right ones:
 * saving keeps a copy on the handset that survives losing signal; sharing hands
 * the file to another app and keeps nothing. Those are different decisions with
 * different consequences in the field, and the sheet gives each one a line of
 * explanation, an icon, and a target big enough to hit with gloves on.
 *
 * Deliberately not a dependency. A bottom-sheet library would be several
 * hundred kilobytes and a native module for one modal with two rows in it; this
 * is `Modal` plus two `Animated.Value`s.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ExportOption {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One line on what this choice actually does. Not a restatement of the title. */
  description: string;
  onSelect: () => void;
}

interface ExportSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: ExportOption[];
  onClose: () => void;
  /** Shown under the options — the file name, a size, a caveat. */
  footnote?: string;
}

const OPEN_MS = 220;
const CLOSE_MS = 160;

export function ExportSheet({
  visible,
  title,
  subtitle,
  options,
  onClose,
  footnote,
}: ExportSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  /**
   * `mounted` lags `visible` on the way out so the close animation has
   * something to animate. Without it the modal unmounts on the same frame the
   * choice is made and the sheet vanishes rather than leaving.
   */
  const [mounted, setMounted] = React.useState(visible);

  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        // Decelerate: the sheet arrives quickly and settles, which reads as the
        // panel being thrown up rather than eased in.
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, progress]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    // Travels a fixed distance rather than the sheet's own height, which is not
    // known until after layout — measuring it would cost a frame of flicker.
    outputRange: [Math.min(height * 0.4, 360), 0],
  });

  return (
    <Modal
      visible
      transparent
      // The animation is ours; the platform's would fight it.
      animationType="none"
      // Android's hardware back button must dismiss a sheet, or it exits the
      // screen behind it and the officer loses their place.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          {/* The backdrop is the dismiss target, and it is labelled, because a
              screen reader otherwise announces an unlabelled tappable rectangle
              covering the whole display. */}
          <Pressable
            style={[StyleSheet.absoluteFill, styles.backdrop]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            shadow.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm },
            { opacity: progress, transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.grabber} />

          <Txt variant="title">{title}</Txt>
          {subtitle ? (
            <Txt variant="body" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
              {subtitle}
            </Txt>
          ) : null}

          <View style={{ marginTop: spacing.lg }}>
            {options.map((option, index) => (
              <OptionRow
                key={option.key}
                option={option}
                first={index === 0}
                onSelect={() => {
                  // Close first: the choice is made, and leaving the sheet up
                  // while a document renders reads as a tap that did nothing.
                  onClose();
                  option.onSelect();
                }}
              />
            ))}
          </View>

          {footnote ? (
            <Txt
              variant="caption"
              color={colors.textFaint}
              center
              style={{ marginTop: spacing.base }}
            >
              {footnote}
            </Txt>
          ) : null}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
          >
            <Txt variant="bodyStrong" color={colors.textMuted}>
              Cancel
            </Txt>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function OptionRow({
  option,
  first,
  onSelect,
}: {
  option: ExportOption;
  first: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={option.title}
      accessibilityHint={option.description}
      style={({ pressed }) => [
        styles.option,
        !first && { marginTop: spacing.sm },
        pressed && styles.optionPressed,
      ]}
    >
      <View style={styles.optionIcon}>
        <Ionicons name={option.icon} size={22} color={colors.navy} />
      </View>

      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">{option.title}</Txt>
        <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
          {option.description}
        </Txt>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.base,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    // Comfortably above the 48dp floor: this is a decision, and the two rows
    // sit next to each other, so the target has to be hard to mis-hit.
    minHeight: 72,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  optionPressed: {
    backgroundColor: colors.navyTint,
    borderColor: colors.accent,
    transform: [{ scale: 0.995 }],
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navyTint,
  },
  cancel: {
    minHeight: HIT_TARGET,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.neutralSoft,
  },
});

/** Kept beside the sheet so a caller cannot drift from the typography scale. */
export const exportSheetTypography = typography;
