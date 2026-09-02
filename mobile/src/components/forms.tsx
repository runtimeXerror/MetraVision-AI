import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { HIT_TARGET, colors, radius, spacing, typography } from '../constants/theme';

import { Row, Txt } from './ui';

/**
 * Form controls.
 *
 * Kept apart from `ui.tsx` because these own focus and validation state, while
 * the primitives there are presentational.
 */

interface InputProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Renders the eye toggle for password fields. */
  secure?: boolean;
  required?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({
  label,
  error,
  hint,
  icon,
  secure,
  required,
  containerStyle,
  multiline,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.accent : colors.border;

  return (
    <View style={[{ marginBottom: spacing.base }, containerStyle]}>
      <Row gap={spacing.xs} style={{ marginBottom: 6 }}>
        <Txt variant="label" color={colors.textMuted}>
          {label}
        </Txt>
        {required ? (
          <Txt variant="label" color={colors.danger}>
            *
          </Txt>
        ) : null}
      </Row>

      <View
        style={[
          styles.inputWrap,
          { borderColor, backgroundColor: colors.surface },
          multiline && { minHeight: 108, alignItems: 'flex-start', paddingVertical: spacing.md },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={19}
            color={focused ? colors.accent : colors.textFaint}
            style={{ marginTop: multiline ? 2 : 0 }}
          />
        ) : null}

        <TextInput
          {...rest}
          multiline={multiline}
          secureTextEntry={secure && !revealed}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          placeholderTextColor={colors.textFaint}
          style={[
            typography.body,
            styles.input,
            multiline && { textAlignVertical: 'top', height: 90 },
          ]}
          accessibilityLabel={label}
        />

        {secure ? (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={19}
              color={colors.textFaint}
            />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Row gap={4} style={{ marginTop: 6 }}>
          <Ionicons name="alert-circle" size={13} color={colors.danger} />
          <Txt variant="caption" color={colors.danger}>
            {error}
          </Txt>
        </Row>
      ) : hint ? (
        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 6 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/* ── Select ───────────────────────────────────────────────────────────────── */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * Bottom-sheet picker.
 *
 * A modal rather than an inline list because the category list is long enough
 * that inlining it would push the rest of the form off-screen on a small device.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  placeholder = 'Select…',
  onChange,
  error,
  hint,
  clearable,
}: {
  label: string;
  value?: T;
  options: Array<SelectOption<T>>;
  placeholder?: string;
  onChange: (value: T | undefined) => void;
  error?: string;
  hint?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={{ marginBottom: spacing.base }}>
      <Txt variant="label" color={colors.textMuted} style={{ marginBottom: 6 }}>
        {label}
      </Txt>

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected?.label ?? placeholder}`}
        style={[styles.inputWrap, { borderColor: error ? colors.danger : colors.border }]}
      >
        <Txt variant="body" color={selected ? colors.text : colors.textFaint} style={{ flex: 1 }}>
          {selected?.label ?? placeholder}
        </Txt>
        <Ionicons name="chevron-down" size={18} color={colors.textFaint} />
      </Pressable>

      {hint ? (
        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 6 }}>
          {hint}
        </Txt>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button">
          {/* Stops a tap inside the sheet from dismissing it. */}
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.grabber} />
            <Txt variant="heading" style={{ marginBottom: spacing.md }}>
              {label}
            </Txt>

            <ScrollView style={{ maxHeight: 380 }}>
              {clearable ? (
                <Pressable
                  onPress={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  style={styles.option}
                >
                  <Txt variant="body" color={colors.textMuted}>
                    {placeholder}
                  </Txt>
                </Pressable>
              ) : null}

              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.option, active && { backgroundColor: colors.accentSoft }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt variant={active ? 'bodyStrong' : 'body'}>{option.label}</Txt>
                      {option.description ? (
                        <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                          {option.description}
                        </Txt>
                      ) : null}
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.base,
    borderWidth: 1.5,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    color: colors.text,
    paddingVertical: spacing.md,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
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
    gap: spacing.md,
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
});

/* ── Filter dropdown ──────────────────────────────────────────────────────── */

/**
 * A compact dropdown for a filter bar.
 *
 * Distinct from `Select`, which is a full-width labelled form field. A filter is
 * not a field being filled in — it is a control being adjusted, so it reads as a
 * pill carrying its current value, and it says which dimension it narrows
 * ("Period: Last 7 days") rather than relying on position to explain itself.
 */
export function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  icon = 'calendar-outline',
  style,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; description?: string }>;
  onChange: (value: T) => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  // A filter sitting at its default is not narrowing anything, so it stays
  // quiet; one that is active is tinted, because an inspector looking at a
  // short list needs to see at a glance why it is short.
  const active = options[0] !== undefined && value !== options[0].value;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? 'any'}. Change`}
        style={({ pressed }) => [
          filterStyles.filterPill,
          active && { borderColor: colors.navy, backgroundColor: colors.navyTint },
          pressed && { opacity: 0.85 },
          style,
        ]}
      >
        <Ionicons name={icon} size={15} color={active ? colors.navy : colors.textMuted} />
        <Txt variant="label" color={colors.textMuted}>
          {label}
        </Txt>
        <Txt variant="label" color={active ? colors.navy : colors.text} numberOfLines={1}>
          {selected?.label ?? 'Any'}
        </Txt>
        <Ionicons name="chevron-down" size={14} color={colors.textFaint} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button">
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.grabber} />
            <Txt variant="heading" style={{ marginBottom: spacing.md }}>
              {label}
            </Txt>

            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  style={[styles.option, isSelected && { backgroundColor: colors.accentSoft }]}
                >
                  <View style={{ flex: 1 }}>
                    <Txt variant={isSelected ? 'bodyStrong' : 'body'}>{option.label}</Txt>
                    {option.description ? (
                      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                        {option.description}
                      </Txt>
                    ) : null}
                  </View>
                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const filterStyles = StyleSheet.create({
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: HIT_TARGET - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
