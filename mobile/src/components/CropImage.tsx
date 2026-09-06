import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { colors, radius, spacing } from '../constants/theme';

import { Button, Row, Txt } from './ui';

/**
 * ── CROPPING A CAPTURED LABEL ───────────────────────────────────────────────
 *
 * The capture path deliberately does not crop. `allowsEditing` on the picker
 * hands the inspector a mandatory crop box before they have seen what the
 * camera got, and a declaration trimmed off at that moment is gone with nothing
 * to show it ever existed — the reading simply comes back without a net
 * quantity and nobody can tell whether the packet lacked one.
 *
 * This is the other thing, and it is safe for the opposite reason: it happens
 * *after* the photograph exists, on a picture the inspector is looking at, and
 * it is optional. What it is for is the frame that caught half a shelf — the
 * packet occupying a fifth of the image, the rest of it a counter and a hand.
 * That is not a cosmetic complaint. Detection resolves text by its size in the
 * frame, so a label at a fifth of the width is a label at a fifth of the
 * resolution, and the declarations that fail first are the small ones, which on
 * a Legal Metrology label is most of what matters.
 *
 * ── WHY THE ORIGINAL IS NOT OVERWRITTEN ────────────────────────────────────
 *
 * `manipulateAsync` writes a new file and the caller swaps the store entry to
 * point at it. The captured original stays on disk untouched, so a crop that
 * took too much is recoverable, and the evidence the inspector actually stood
 * in front of is never destroyed by an edit.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Small enough to allow a tight trim, large enough that a slip cannot ruin it. */
const MIN_SIDE = 48;

/** How far outside the box a corner still answers to a finger. */
const HANDLE = 32;

interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropResult {
  uri: string;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  uri: string | null;
  onCancel: () => void;
  onCropped: (result: CropResult) => void;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

export function CropImage({ visible, uri, onCancel, onCropped }: Props): React.ReactElement {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState<CropBox | null>(null);
  const [working, setWorking] = useState(false);

  /* The box while a drag is in flight. State lags a finger; a ref does not. */
  const live = useRef<CropBox | null>(null);
  const start = useRef<CropBox | null>(null);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;

    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled) setNatural({ width, height });
      },
      () => {
        // A size that cannot be read means the crop maths has no frame of
        // reference, so the screen stays on its spinner rather than offering a
        // box that would map to the wrong pixels.
        if (!cancelled) setNatural(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [uri]);

  /* Where the letterboxed photograph actually sits inside the frame. */
  const fitted = useMemo(() => {
    if (!natural || frame.width === 0 || frame.height === 0) return null;
    const scale = Math.min(frame.width / natural.width, frame.height / natural.height);
    const width = natural.width * scale;
    const height = natural.height * scale;
    return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height, scale };
  }, [natural, frame]);

  /* Start with the whole picture selected: cropping is opt-in, per corner. */
  useEffect(() => {
    if (!fitted) return;
    const initial = { x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height };
    setBox(initial);
    live.current = initial;
  }, [fitted]);

  const reset = useCallback(() => {
    if (!fitted) return;
    const initial = { x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height };
    setBox(initial);
    live.current = initial;
  }, [fitted]);

  /**
   * One corner's drag.
   *
   * Each corner moves two edges and leaves the opposite two alone, which is
   * what makes the box feel like a box rather than a rectangle that jumps. The
   * clamps keep it inside the photograph — a crop that runs off the edge of the
   * image maps to pixels that do not exist, and `manipulateAsync` fails on it.
   */
  const cornerResponder = useCallback(
    (corner: Corner) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = live.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const from = start.current;
          if (!from || !fitted) return;

          let { x, y, width, height } = from;
          const right = from.x + from.width;
          const bottom = from.y + from.height;
          const edgeRight = fitted.x + fitted.width;
          const edgeBottom = fitted.y + fitted.height;

          if (corner === 'tl' || corner === 'bl') {
            x = Math.min(Math.max(fitted.x, from.x + gesture.dx), right - MIN_SIDE);
            width = right - x;
          } else {
            width = Math.min(Math.max(MIN_SIDE, from.width + gesture.dx), edgeRight - from.x);
          }

          if (corner === 'tl' || corner === 'tr') {
            y = Math.min(Math.max(fitted.y, from.y + gesture.dy), bottom - MIN_SIDE);
            height = bottom - y;
          } else {
            height = Math.min(Math.max(MIN_SIDE, from.height + gesture.dy), edgeBottom - from.y);
          }

          const next = { x, y, width, height };
          live.current = next;
          setBox(next);
        },
        onPanResponderRelease: () => {
          start.current = live.current;
        },
      }),
    [fitted],
  );

  const responders = useMemo(
    () => ({
      tl: cornerResponder('tl'),
      tr: cornerResponder('tr'),
      bl: cornerResponder('bl'),
      br: cornerResponder('br'),
    }),
    [cornerResponder],
  );

  const apply = useCallback(async () => {
    if (!uri || !box || !fitted || !natural) return;

    setWorking(true);
    try {
      /*
       * Screen points back to image pixels.
       *
       * Rounded and then clamped, in that order: rounding can push the far edge
       * one pixel past the image on a fractional scale, and the native cropper
       * rejects a rectangle that leaves the bitmap rather than trimming it.
       */
      const originX = Math.max(0, Math.round((box.x - fitted.x) / fitted.scale));
      const originY = Math.max(0, Math.round((box.y - fitted.y) / fitted.scale));
      const width = Math.min(natural.width - originX, Math.round(box.width / fitted.scale));
      const height = Math.min(natural.height - originY, Math.round(box.height / fitted.scale));

      if (width < 1 || height < 1) {
        onCancel();
        return;
      }

      const context = ImageManipulator.manipulate(uri);
      context.crop({ originX, originY, width, height });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        compress: 0.92,
        format: SaveFormat.JPEG,
      });

      onCropped({ uri: saved.uri, width: saved.width, height: saved.height });
    } catch {
      // A failed crop leaves the original in place, which is the safe outcome:
      // the inspector still has the photograph they took.
      onCancel();
    } finally {
      setWorking(false);
    }
  }, [uri, box, fitted, natural, onCropped, onCancel]);

  const onFrameLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame({ width, height });
  }, []);

  const untouched =
    box !== null &&
    fitted !== null &&
    Math.abs(box.width - fitted.width) < 1 &&
    Math.abs(box.height - fitted.height) < 1;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.screen}>
        <Row justify="space-between" style={styles.header}>
          <Txt variant="heading" color={colors.textInverse}>
            Trim the photograph
          </Txt>
          <Pressable
            onPress={onCancel}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cancel cropping"
          >
            <Ionicons name="close" size={26} color={colors.textInverse} />
          </Pressable>
        </Row>

        <View style={styles.stage} onLayout={onFrameLayout}>
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}

          {box ? (
            <>
              {/* The area being cut away, dimmed on all four sides. */}
              <View style={[styles.shade, { left: 0, right: 0, top: 0, height: box.y }]} />
              <View style={[styles.shade, { left: 0, right: 0, top: box.y + box.height, bottom: 0 }]} />
              <View style={[styles.shade, { left: 0, width: box.x, top: box.y, height: box.height }]} />
              <View
                style={[
                  styles.shade,
                  { left: box.x + box.width, right: 0, top: box.y, height: box.height },
                ]}
              />

              <View
                pointerEvents="none"
                style={[
                  styles.box,
                  { left: box.x, top: box.y, width: box.width, height: box.height },
                ]}
              />

              <View
                {...responders.tl.panHandlers}
                style={[styles.handle, { left: box.x - HANDLE / 2, top: box.y - HANDLE / 2 }]}
              >
                <View style={[styles.grip, styles.gripTl]} />
              </View>
              <View
                {...responders.tr.panHandlers}
                style={[
                  styles.handle,
                  { left: box.x + box.width - HANDLE / 2, top: box.y - HANDLE / 2 },
                ]}
              >
                <View style={[styles.grip, styles.gripTr]} />
              </View>
              <View
                {...responders.bl.panHandlers}
                style={[
                  styles.handle,
                  { left: box.x - HANDLE / 2, top: box.y + box.height - HANDLE / 2 },
                ]}
              >
                <View style={[styles.grip, styles.gripBl]} />
              </View>
              <View
                {...responders.br.panHandlers}
                style={[
                  styles.handle,
                  {
                    left: box.x + box.width - HANDLE / 2,
                    top: box.y + box.height - HANDLE / 2,
                  },
                ]}
              >
                <View style={[styles.grip, styles.gripBr]} />
              </View>
            </>
          ) : (
            <ActivityIndicator color={colors.textInverse} />
          )}
        </View>

        <View style={styles.footer}>
          <Txt variant="caption" color={colors.navyTint} style={{ marginBottom: spacing.md }}>
            Drag the corners to the edges of the packet. Everything shaded is cut away — keep the
            whole label in frame, including the small print.
          </Txt>

          <Row gap={spacing.md}>
            <Button
              title="Reset"
              icon="refresh-outline"
              variant="secondary"
              style={{ flex: 1 }}
              disabled={untouched || working}
              onPress={reset}
            />
            <Button
              title={working ? 'Trimming…' : 'Apply'}
              icon="crop-outline"
              style={{ flex: 1 }}
              disabled={untouched || working}
              onPress={() => void apply()}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navyDeep },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  stage: { flex: 1, margin: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.textInverse,
    borderRadius: radius.sm,
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grip: { width: 20, height: 20, borderColor: colors.textInverse },
  gripTl: { borderLeftWidth: 4, borderTopWidth: 4 },
  gripTr: { borderRightWidth: 4, borderTopWidth: 4 },
  gripBl: { borderLeftWidth: 4, borderBottomWidth: 4 },
  gripBr: { borderRightWidth: 4, borderBottomWidth: 4 },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
});
