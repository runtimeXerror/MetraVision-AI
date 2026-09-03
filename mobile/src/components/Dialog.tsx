import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { colors, radius, shadow, spacing, HIT_TARGET } from '../constants/theme';

import { Txt } from './ui';

/**
 * ── DIALOGS ─────────────────────────────────────────────────────────────────
 *
 * Every confirmation, warning and choice the app asks for, in the app's own
 * design language.
 *
 * These were `Alert.alert` before. That was fine functionally and wrong in
 * every other way: the system alert is styled by the operating system, so a
 * tool that is otherwise a piece of departmental software suddenly looked like
 * a stock phone dialog at exactly the moments that matter most — discarding an
 * inspection, deleting a photograph, confirming an export. It also cannot
 * carry an icon, a tone, or destructive emphasis beyond iOS's red text, and it
 * renders differently on the two platforms, so the same warning read as
 * different levels of serious depending on the phone.
 *
 * ── The imperative API ─────────────────────────────────────────────────────
 *
 * `Alert.alert` is called from event handlers, hooks and services — places
 * with no JSX to render into. Rebuilding those into rendered state would mean
 * a `visible` flag and a pending-action variable in a dozen components, which
 * is how a confirmation eventually fires against the wrong record. So the
 * dialog keeps the shape the call sites already have, and returns a promise:
 *
 *     const choice = await dialog({
 *       title: 'Delete this photograph?',
 *       message: 'It will be removed from the inspection.',
 *       tone: 'danger',
 *       actions: [
 *         { label: 'Delete', value: 'delete', style: 'destructive' },
 *         { label: 'Keep', value: null, style: 'cancel' },
 *       ],
 *     });
 *
 * One `<DialogHost />` is mounted at the root. Nothing else renders it.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type DialogTone = 'info' | 'warning' | 'danger' | 'success';

export interface DialogAction<T = unknown> {
  label: string;
  /** Resolved to the caller when this action is chosen. */
  value: T;
  /**
   * `default` is the affirmative action, `destructive` warns, and `cancel` is
   * the way out. Cancel is always rendered last and quietest, whatever order
   * it is passed in.
   */
  style?: 'default' | 'destructive' | 'cancel';
}

export interface DialogRequest<T = unknown> {
  title: string;
  message?: string;
  tone?: DialogTone;
  actions: Array<DialogAction<T>>;
  /**
   * What a dismissal resolves to — Android's back button, or a tap outside.
   * Defaults to the `cancel` action's value, then `undefined`.
   */
  dismissValue?: T;
}

interface DialogState {
  request: (DialogRequest<unknown> & { resolve: (value: unknown) => void }) | null;
  open: (request: DialogRequest<unknown>, resolve: (value: unknown) => void) => void;
  close: (value: unknown) => void;
}

const useDialogStore = create<DialogState>((set, get) => ({
  request: null,

  open(request, resolve) {
    // A second dialog raised while one is open would replace it and strand the
    // first promise for ever. The earlier one is resolved as dismissed first,
    // so its caller always finishes.
    const current = get().request;
    if (current) current.resolve(current.dismissValue);

    set({ request: { ...request, resolve } });
  },

  close(value) {
    const current = get().request;
    if (!current) return;
    set({ request: null });
    current.resolve(value);
  },
}));

/** Raises a dialog and resolves with the chosen action's `value`. */
export function dialog<T>(request: DialogRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    useDialogStore
      .getState()
      .open(request as DialogRequest<unknown>, resolve as (value: unknown) => void);
  });
}

/** The common case: one question, yes or no. Resolves `true` when confirmed. */
export function confirm(options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  destructive?: boolean;
}): Promise<boolean> {
  return dialog<boolean>({
    title: options.title,
    message: options.message,
    tone: options.tone ?? (options.destructive ? 'danger' : 'info'),
    dismissValue: false,
    actions: [
      {
        label: options.confirmLabel ?? 'Confirm',
        value: true,
        style: options.destructive ? 'destructive' : 'default',
      },
      { label: options.cancelLabel ?? 'Cancel', value: false, style: 'cancel' },
    ],
  }).then((value) => value === true);
}

/** A statement, not a question. Resolves once acknowledged. */
export function notify(options: {
  title: string;
  message?: string;
  tone?: DialogTone;
  actionLabel?: string;
}): Promise<void> {
  return dialog<void>({
    title: options.title,
    message: options.message,
    tone: options.tone ?? 'info',
    actions: [{ label: options.actionLabel ?? 'OK', value: undefined, style: 'default' }],
  }).then(() => undefined);
}

const TONE: Record<DialogTone, { icon: keyof typeof Ionicons.glyphMap; fg: string; bg: string }> = {
  info: { icon: 'information-circle', fg: colors.info, bg: colors.infoSoft },
  warning: { icon: 'alert-circle', fg: colors.warning, bg: colors.warningSoft },
  danger: { icon: 'warning', fg: colors.danger, bg: colors.dangerSoft },
  success: { icon: 'checkmark-circle', fg: colors.success, bg: colors.successSoft },
};

/** Cancel always sits last, however the caller ordered the actions. */
function ordered<T>(actions: Array<DialogAction<T>>): Array<DialogAction<T>> {
  return [...actions].sort((a, b) => Number(a.style === 'cancel') - Number(b.style === 'cancel'));
}

export function DialogHost() {
  const request = useDialogStore((state) => state.request);
  const close = useDialogStore((state) => state.close);

  const [mounted, setMounted] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (request) setMounted(true);

    Animated.timing(progress, {
      toValue: request ? 1 : 0,
      duration: request ? 160 : 120,
      easing: request ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Unmounted only after the exit animation, or the dialog vanishes
      // instantly and the dismissal reads as a glitch rather than a choice.
      if (finished && !request) setMounted(false);
    });
  }, [request, progress]);

  if (!mounted) return null;

  const tone = TONE[request?.tone ?? 'info'];
  const actions = request ? ordered(request.actions) : [];

  const dismiss = (): void => {
    if (!request) return;
    const cancel = request.actions.find((action) => action.style === 'cancel');
    close(request.dismissValue ?? cancel?.value);
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.backdrop]}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            shadow.sheet,
            {
              opacity: progress,
              transform: [
                {
                  // A short rise rather than a scale: scaling text mid-animation
                  // makes it blur on Android.
                  translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={22} color={tone.fg} />
          </View>

          <Txt variant="title" center style={{ marginTop: spacing.base }}>
            {request?.title}
          </Txt>

          {request?.message ? (
            <Txt
              variant="body"
              color={colors.textMuted}
              center
              style={{ marginTop: spacing.sm, lineHeight: 21 }}
            >
              {request.message}
            </Txt>
          ) : null}

          <View style={{ marginTop: spacing.lg }}>
            {actions.map((action, index) => (
              <ActionButton
                key={`${action.label}-${index}`}
                action={action}
                first={index === 0}
                onPress={() => close(action.value)}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ActionButton({
  action,
  first,
  onPress,
}: {
  action: DialogAction<unknown>;
  first: boolean;
  onPress: () => void;
}) {
  const destructive = action.style === 'destructive';
  const cancel = action.style === 'cancel';

  const background = cancel ? colors.surfaceAlt : destructive ? colors.danger : colors.accent;
  const label = cancel ? colors.textMuted : colors.textInverse;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: background },
        cancel && styles.actionCancel,
        !first && { marginTop: spacing.sm },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Txt variant="bodyStrong" color={label}>
        {action.label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  backdrop: { backgroundColor: colors.overlay },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    // Full width, stacked. Side-by-side buttons put the destructive action
    // under the thumb that was reaching for the safe one.
    alignSelf: 'stretch',
  },
  actionCancel: {
    borderWidth: 1,
    borderColor: colors.border,
  },
});
