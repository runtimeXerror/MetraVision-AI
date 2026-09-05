import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useCachedUri } from './offline';

/**
 * A photograph that can be pinched, dragged and double-tapped.
 *
 * The preview used to be a plain `<Image>`, which is fine for checking that the
 * right face was captured and useless for the thing an inspector actually opens
 * it to do: read a six-point declaration off the back of a packet. The text is
 * legible on the packet and not on a phone-sized rendering of it, so the
 * photograph had to be retaken — or the declaration simply recorded as
 * unreadable — when the detail was there in the file all along.
 *
 * Built on `Animated` and `PanResponder`, both of which ship with React Native.
 * The alternative was `react-native-gesture-handler`, which is the nicer API and
 * a new native dependency; this screen needs pinch, drag and double-tap, and
 * those are cheap enough to write against the core primitives that adding a
 * native module to the build to get them is not a trade worth making.
 */

/** Below this the image springs back; the photograph never sits smaller than its frame. */
const MIN_SCALE = 1;

/**
 * The ceiling on magnification.
 *
 * Four is enough to bring 6pt legal text on a 12 MP capture up to a readable
 * size, and past it the inspector is looking at the camera's noise rather than
 * the label.
 */
const MAX_SCALE = 4;

/**
 * Where a double-tap lands.
 *
 * A step short of the ceiling: it is a shortcut to "closer", not to the limit,
 * and it leaves room to pinch further from there.
 */
const DOUBLE_TAP_SCALE = 2.5;

/** Two taps further apart than this are two single taps. */
const DOUBLE_TAP_MS = 280;

/** Finger travel that still counts as a tap rather than a drag. */
const TAP_SLOP = 12;

/** Rubber-banding allowance, so a pinch past a limit resists instead of stopping dead. */
const OVERSHOOT = 1.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function distanceBetween(touches: Array<{ pageX: number; pageY: number }>): number {
  const [a, b] = touches;
  if (!a || !b) return 0;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export interface ZoomableImageProps {
  uri: string;
  /** Applied to the frame the image is laid out in, not to the image itself. */
  style?: StyleProp<ViewStyle>;
  /**
   * Called when the image is tapped once and is not zoomed in.
   *
   * Lets the caller keep tap-to-dismiss without it firing every time a zoomed
   * photograph is being dragged around.
   */
  onSingleTap?: () => void;
}

export function ZoomableImage({ uri, style, onSingleTap }: ZoomableImageProps) {
  const cachedUri = useCachedUri(uri);

  // The animated values drive the view; the refs are what the gesture maths
  // reads. Animated.Value has no synchronous getter, and tracking the committed
  // position separately is both simpler and cheaper than attaching listeners.
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const committed = useRef({ scale: 1, x: 0, y: 0 });
  const pinch = useRef({ active: false, startDistance: 0, startScale: 1 });
  const lastTapAt = useRef(0);

  /**
   * The pending single tap.
   *
   * A single tap cannot be resolved until the double-tap window has passed —
   * every double tap begins as a single one. Firing immediately was survivable
   * while the only caller toggled some chrome, and became a real defect the
   * moment a caller wired dismissal to it: in the full-screen viewer, the first
   * tap of a double-tap-to-zoom closed the viewer, so the gesture could never
   * be completed and the photograph could not be magnified by tapping at all.
   */
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingTap = useCallback(() => {
    if (pendingTap.current) {
      clearTimeout(pendingTap.current);
      pendingTap.current = null;
    }
  }, []);

  // A tap resolved after the view has gone would call back into a screen that
  // is no longer mounted — a dismissal firing on a viewer already closed.
  useEffect(() => cancelPendingTap, [cancelPendingTap]);

  const [frame, setFrame] = useState({ width: 0, height: 0 });

  /**
   * How far the image may be dragged before it would pull away from its frame.
   *
   * Measured against the frame rather than the image's own rendered size: under
   * `resizeMode="contain"` a photograph is letterboxed, so this is a little
   * generous on the short axis. That errs towards letting the inspector move
   * the picture freely, which is the right way to be wrong here.
   */
  const boundsFor = useCallback(
    (current: number) => ({
      x: Math.max(0, (frame.width * current - frame.width) / 2),
      y: Math.max(0, (frame.height * current - frame.height) / 2),
    }),
    [frame.width, frame.height],
  );

  const settle = useCallback(
    (nextScale: number, nextX: number, nextY: number) => {
      const bounded = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const limit = boundsFor(bounded);
      const x = clamp(nextX, -limit.x, limit.x);
      const y = clamp(nextY, -limit.y, limit.y);

      committed.current = { scale: bounded, x, y };

      // Springs rather than jumps: a photograph that snaps back from a limit
      // reads as a bug, one that eases back reads as an edge.
      //
      // Driven from JS, not natively. The gesture itself moves these values
      // with `setValue` on every frame, which is a JS-side write; keeping the
      // springs on the same side of the bridge means one owner per node
      // instead of two taking turns, and it is what makes `stopAnimation`
      // below reliably hand back the value the fingers actually left behind.
      Animated.parallel([
        Animated.spring(scale, { toValue: bounded, useNativeDriver: false, bounciness: 0 }),
        Animated.spring(translateX, { toValue: x, useNativeDriver: false, bounciness: 0 }),
        Animated.spring(translateY, { toValue: y, useNativeDriver: false, bounciness: 0 }),
      ]).start();
    },
    [boundsFor, scale, translateX, translateY],
  );

  const reset = useCallback(() => {
    committed.current = { scale: 1, x: 0, y: 0 };
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
  }, [scale, translateX, translateY]);

  // Opening a different photograph must not inherit the last one's zoom — the
  // inspector would be looking at a magnified corner of an image they have not
  // examined yet, with no indication that is what they are seeing.
  useEffect(() => reset(), [uri, reset]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          // Claim the gesture for a pinch always, and for a drag only once
          // there is something to drag — an unzoomed image should leave a
          // single finger alone so anything scrolling behind it still works.
          gesture.numberActiveTouches === 2 ||
          committed.current.scale > 1 ||
          Math.hypot(gesture.dx, gesture.dy) > TAP_SLOP,
        // The image keeps the gesture once it has it; nothing above it has a
        // better claim on a finger that is mid-pinch.
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: () => {
          pinch.current.active = false;
        },

        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;

          if (touches.length === 2) {
            const separation = distanceBetween(touches);
            if (separation <= 0) return;

            // The first two-finger frame establishes the reference, so a pinch
            // that begins part-way through a drag scales from where the image
            // actually is rather than snapping.
            if (!pinch.current.active) {
              pinch.current = {
                active: true,
                startDistance: separation,
                startScale: committed.current.scale,
              };
              return;
            }

            const ratio = separation / pinch.current.startDistance;
            scale.setValue(
              clamp(
                pinch.current.startScale * ratio,
                MIN_SCALE / OVERSHOOT,
                MAX_SCALE * OVERSHOOT,
              ),
            );
            return;
          }

          // One finger: drag, but only when the image is larger than its frame.
          if (pinch.current.active || committed.current.scale <= 1) return;

          translateX.setValue(committed.current.x + gesture.dx);
          translateY.setValue(committed.current.y + gesture.dy);
        },

        onPanResponderRelease: (_event, gesture) => {
          const wasPinching = pinch.current.active;
          pinch.current.active = false;

          if (wasPinching) {
            // The live pinch value lives on the animated value and may be past
            // a limit; `stopAnimation` hands it back, and `settle` is what
            // clamps it and pulls the image inside its bounds again.
            scale.stopAnimation((value: number) => {
              settle(value, committed.current.x, committed.current.y);
            });
            return;
          }

          const travelled = Math.hypot(gesture.dx, gesture.dy);

          if (travelled <= TAP_SLOP) {
            const now = Date.now();

            if (now - lastTapAt.current < DOUBLE_TAP_MS) {
              lastTapAt.current = 0;
              // The second tap arrived, so the first one was never a single
              // tap. Withdraw it before it can fire.
              cancelPendingTap();
              // Double tap toggles: in from anywhere, and all the way back out
              // if already magnified. Re-centring on the way out matters —
              // otherwise the inspector lands back at 1x holding an offset.
              if (committed.current.scale > 1.05) settle(1, 0, 0);
              else settle(DOUBLE_TAP_SCALE, 0, 0);
              return;
            }

            lastTapAt.current = now;

            // Only at rest. A tap on a photograph the inspector has zoomed into
            // is how they stop a drag, not a request to dismiss it.
            if (committed.current.scale <= 1.05 && onSingleTap) {
              cancelPendingTap();
              pendingTap.current = setTimeout(() => {
                pendingTap.current = null;
                onSingleTap();
              }, DOUBLE_TAP_MS);
            }
            return;
          }

          settle(
            committed.current.scale,
            committed.current.x + gesture.dx,
            committed.current.y + gesture.dy,
          );
        },
      }),
    [cancelPendingTap, onSingleTap, scale, settle, translateX, translateY],
  );

  return (
    <View
      style={[styles.frame, style]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setFrame({ width, height });
      }}
      {...responder.panHandlers}
    >
      <Animated.Image
        // The locally cached copy where there is one. Reading a declaration off
        // a label is the reason this viewer exists, and it must not stop working
        // the moment the officer loses signal.
        source={{ uri: cachedUri }}
        resizeMode="contain"
        style={[
          styles.image,
          // Scale last: listed this way the translation stays in screen pixels,
          // which is the space `boundsFor` measures. With the scale first the
          // drag limits would be multiplied by the zoom level and the image
          // would slide clean off the frame at 4x.
          { transform: [{ translateX }, { translateY }, { scale }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
