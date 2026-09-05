import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { imageSideLabels } from '../constants/labels';
import { colors, radius, spacing } from '../constants/theme';
import type { BoundingBox, ProductImage } from '../types';

import { ZoomableImage } from './ZoomableImage';
import { Txt } from './ui';

/**
 * ── THE EVIDENCE, FULL SIZE ─────────────────────────────────────────────────
 *
 * A thumbnail of a package label is a picture of a label, not a readable one.
 *
 * The declarations this whole application is about — the MRP, the net quantity,
 * the manufacturer's address, the six-point minimum type height — are printed
 * small on the packet and then rendered into a 72-pixel square on the record
 * screen. An officer checking whether the engine read `₹l99.00` as a rupee sign
 * or a letter L could see the thumbnail and had nowhere to go from it. The
 * detail was in the file the entire time.
 *
 * So every photograph on a filed record opens. `ZoomableImage` already existed
 * for the capture preview and does the pinch, drag and double-tap; this is the
 * frame around it — full screen, black, with the face label, a counter and a
 * way between the photographs without going back out to the list.
 *
 * Black ground on purpose, and it is not decoration: a label photographed
 * against a shop counter is judged on its own contrast, and a white page around
 * it drags the eye's adaptation the wrong way.
 * ────────────────────────────────────────────────────────────────────────────
 */

export function ImageViewer({
  images,
  startIndex = 0,
  visible,
  onClose,
  highlight,
}: {
  images: ProductImage[];
  /** Which photograph the officer tapped. */
  startIndex?: number;
  visible: boolean;
  onClose: () => void;
  /**
   * Where on the photograph a declaration was read, as a fraction of the frame.
   *
   * Carried through from the evidence view so magnifying a reading does not
   * lose the one thing the evidence view was for: *where* on the label the
   * value came from. Only meaningful for a single photograph, so it is dropped
   * as soon as the officer pages to another one — the box belongs to the image
   * it was measured on.
   */
  highlight?: BoundingBox;
}) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(startIndex);

  // Re-seated each time it opens. Without this, opening the third photograph,
  // closing, then tapping the first would reopen on the third.
  useEffect(() => {
    if (visible) setIndex(startIndex);
  }, [visible, startIndex]);

  const image = images[index];
  if (!image) return null;

  const many = images.length > 1;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      // Android's back button closes the viewer rather than the screen behind
      // it, which is what `onRequestClose` above is wired to.
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        {/* Header. Absolute rather than in flow, so the photograph gets the
            whole screen to be measured against and the chrome floats over it. */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong" color={colors.textInverse}>
              {imageSideLabels[image.side]}
            </Txt>
            {many ? (
              <Txt variant="caption" color="rgba(255,255,255,0.62)" style={{ marginTop: 2 }}>
                Photograph {index + 1} of {images.length}
              </Txt>
            ) : null}
          </View>

          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close photograph"
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <Ionicons name="close" size={22} color={colors.textInverse} />
          </Pressable>
        </View>

        <ZoomableImage
          key={image.id}
          uri={image.uri}
          style={styles.image}
          // A single tap on the photograph closes, the way a lightbox does.
          // Pinch, drag and double-tap-to-zoom belong to `ZoomableImage`.
          onSingleTap={onClose}
          overlay={
            // Only on the photograph it was measured on. Paging away and still
            // drawing it would put the box over a face it says nothing about.
            highlight && index === startIndex ? (
              <View
                style={[
                  styles.highlight,
                  {
                    left: `${highlight.x * 100}%`,
                    top: `${highlight.y * 100}%`,
                    width: `${highlight.width * 100}%`,
                    height: `${highlight.height * 100}%`,
                  },
                ]}
              />
            ) : null
          }
        />

        {/* Paging. Buttons rather than a swipe: the surface underneath is
            already claimed by pan-at-zoom, and a horizontal drag that sometimes
            moves the image and sometimes changes it is worse than either. */}
        {many ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.base }]}>
            <StepButton
              icon="chevron-back"
              label="Previous photograph"
              disabled={index === 0}
              onPress={() => setIndex((current) => Math.max(0, current - 1))}
            />

            <View style={styles.dots}>
              {images.map((entry, position) => (
                <View
                  key={entry.id}
                  style={[styles.dot, position === index && styles.dotActive]}
                />
              ))}
            </View>

            <StepButton
              icon="chevron-forward"
              label="Next photograph"
              disabled={index === images.length - 1}
              onPress={() => setIndex((current) => Math.min(images.length - 1, current + 1))}
            />
          </View>
        ) : (
          <View style={[styles.hint, { paddingBottom: insets.bottom + spacing.base }]}>
            <Txt variant="caption" color="rgba(255,255,255,0.55)" center>
              Pinch or double-tap to zoom
            </Txt>
          </View>
        )}
      </View>
    </Modal>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.iconButtonPressed,
        disabled && styles.iconButtonDisabled,
      ]}
    >
      <Ionicons name={icon} size={22} color={colors.textInverse} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    // A wash rather than a solid bar: the label has to stay readable over a
    // pale packet without walling off the top of the photograph.
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  image: { flex: 1 },
  /**
   * The evidence box, on a black ground.
   *
   * Amber rather than the app's accent blue: this sits over a photograph whose
   * colours are whatever the packet happened to be, and amber is the one hue
   * that stays visible against printed labels, foil and shadow alike.
   */
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FBBF24',
    borderRadius: 3,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  hint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingTop: spacing.md,
  },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  dotActive: { backgroundColor: colors.textInverse, width: 18 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  iconButtonPressed: { backgroundColor: 'rgba(255,255,255,0.24)' },
  iconButtonDisabled: { opacity: 0.3 },
});
