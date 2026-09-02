import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useState, useEffect } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ImageThumb } from '../../components/domain';
import { ActionBar, Body, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import { Badge, Button, Card, Row, Txt } from '../../components/ui';
import { imageSideLabels } from '../../constants/labels';
import { colors, radius, spacing } from '../../constants/theme';
import { useImageCapture } from '../../hooks/useImageCapture';
import { useDraftStore } from '../../store/draftStore';
import { useImageStore } from '../../store/imageStore';
import { IMAGE_SIDES, type ImageSide, type ProductImage } from '../../types';
import { formatBytes, formatRelative } from '../../utils/format';

import { INSPECTION_STEPS } from './InspectionDetailsScreen';

/**
 * What each face is for.
 *
 * Shown against the selector rather than left implicit: an inspector who
 * photographs four angles of the front of a packet and none of the back has
 * captured nothing the rule engine can use, and the app is the only thing in
 * the room that knows which declarations live where.
 */
const FACE_GUIDANCE: Record<ImageSide, { hint: string; required: boolean }> = {
  front: { hint: 'Brand, product name and net quantity', required: true },
  back: { hint: 'Manufacturer, MRP, dates and consumer care', required: true },
  side: { hint: 'Batch code or any wrapped-around panel', required: false },
  additional: { hint: 'Stickers, over-labels or a second pack', required: false },
};

/** Step 2 — capture the package faces. */
export function CaptureScreen() {
  // Recorded for the autosave, so an interrupted capture resumes on this
  // screen instead of sending the inspector back through steps they had
  // already completed.
  const setDraftStep = useDraftStore((state) => state.setStep);
  useEffect(() => setDraftStep('Capture'), [setDraftStep]);

  const navigation = useNavigation();

  const images = useImageStore((state) => state.images);
  const activeSide = useImageStore((state) => state.activeSide);
  const setActiveSide = useImageStore((state) => state.setActiveSide);
  const removeImage = useImageStore((state) => state.remove);
  const assessQuality = useImageStore((state) => state.assessQuality);

  const { capture, retakeFrom, busy } = useImageCapture();
  const [preview, setPreview] = useState<ProductImage | null>(null);

  const countFor = (side: ImageSide) => images.filter((image) => image.side === side).length;
  const guidance = FACE_GUIDANCE[activeSide];

  const missingRequired = IMAGE_SIDES.filter(
    (side) => FACE_GUIDANCE[side].required && countFor(side) === 0,
  );

  const confirmDelete = (image: ProductImage) => {
    Alert.alert(
      'Delete this image?',
      `The ${imageSideLabels[image.side].toLowerCase()} capture will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeImage(image.id);
            setPreview(null);
          },
        },
      ],
    );
  };

  const onContinue = () => {
    // The quality screen reads `image.quality`, so populate it on the way in.
    assessQuality();
    navigation.navigate('Quality');
  };

  return (
    <Screen>
      <ScreenHeader
        title="Capture Label"
        subtitle="Step 2 of 5 · Photograph the package"
        onBack={() => navigation.goBack()}
        right={
          images.length > 0 ? (
            <Badge label={`${images.length}`} tone="info" icon="images-outline" />
          ) : undefined
        }
      />
      <StepIndicator steps={INSPECTION_STEPS} current={1} />

      <Body padded={false}>
        {/* ── Face selector ──────────────────────────────────────────────────
            Tiles rather than a chip row: each one has to carry a tick and a
            count, which is what tells an inspector at a glance which faces are
            still outstanding. A chip can carry a count but not a state. */}
        <View style={{ paddingHorizontal: spacing.base }}>
          <Txt variant="overline" color={colors.textFaint}>
            Which face are you photographing?
          </Txt>

          <Row gap={spacing.sm} style={{ marginTop: spacing.sm }} align="stretch">
            {IMAGE_SIDES.map((side) => {
              const count = countFor(side);
              const active = side === activeSide;
              const done = count > 0;

              return (
                <Pressable
                  key={side}
                  onPress={() => setActiveSide(side)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${imageSideLabels[side]}, ${count} captured`}
                  style={({ pressed }) => [
                    styles.faceTile,
                    active && styles.faceTileActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={styles.faceTop}>
                    <Ionicons
                      name={done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={15}
                      color={done ? colors.success : active ? colors.navyTint : colors.textFaint}
                    />
                    {count > 1 ? (
                      <Txt
                        variant="caption"
                        color={active ? colors.navyTint : colors.textFaint}
                      >
                        ×{count}
                      </Txt>
                    ) : null}
                  </View>

                  <Txt
                    variant="caption"
                    color={active ? colors.textInverse : colors.text}
                    numberOfLines={2}
                    style={{ marginTop: 4 }}
                  >
                    {imageSideLabels[side]}
                  </Txt>

                  {FACE_GUIDANCE[side].required ? (
                    <Txt
                      variant="caption"
                      color={active ? colors.navyTint : colors.textFaint}
                      style={{ marginTop: 1, fontSize: 10 }}
                    >
                      Required
                    </Txt>
                  ) : null}
                </Pressable>
              );
            })}
          </Row>
        </View>

        {/* ── Capture target ─────────────────────────────────────────────────
            The corner brackets are doing real work: they show the aspect and
            the fill an inspector should aim for before the camera opens, which
            is the moment a bad capture is cheapest to prevent. */}
        <View style={{ paddingHorizontal: spacing.base, marginTop: spacing.lg }}>
          <View style={styles.target}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />

            <Ionicons name="scan-outline" size={30} color={colors.navy} />

            <Txt variant="bodyStrong" center style={{ marginTop: spacing.sm }}>
              {imageSideLabels[activeSide]} of the package
            </Txt>
            <Txt
              variant="caption"
              color={colors.textMuted}
              center
              style={{ marginTop: 3, paddingHorizontal: spacing.lg }}
            >
              {guidance.hint}
            </Txt>

            <Row gap={spacing.md} style={{ marginTop: spacing.lg }}>
              <Button
                title="Open Camera"
                icon="camera"
                size="lg"
                loading={busy}
                onPress={() => void capture('camera', activeSide)}
              />
              <Button
                title="Gallery"
                icon="images-outline"
                variant="secondary"
                size="lg"
                loading={busy}
                onPress={() => void capture('gallery', activeSide)}
              />
            </Row>
          </View>

          <Row gap={spacing.sm} align="flex-start" style={styles.tip}>
            <Ionicons name="bulb-outline" size={15} color={colors.warning} />
            <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              Fill the frame with the label, hold the phone square to the pack, and avoid flash
              glare on foil or glossy film.
            </Txt>
          </Row>
        </View>

        {/* ── Captured ───────────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: spacing.base, marginTop: spacing.xl }}>
          {images.length === 0 ? (
            <Card style={styles.pending}>
              <Txt variant="overline" color={colors.textFaint}>
                Still needed
              </Txt>
              {IMAGE_SIDES.filter((side) => FACE_GUIDANCE[side].required).map((side) => (
                <Row key={side} gap={spacing.sm} style={{ marginTop: spacing.sm }}>
                  <Ionicons name="ellipse-outline" size={14} color={colors.textFaint} />
                  <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                    <Txt variant="caption" color={colors.text}>
                      {imageSideLabels[side]}
                    </Txt>{' '}
                    — {FACE_GUIDANCE[side].hint}
                  </Txt>
                </Row>
              ))}
            </Card>
          ) : (
            <>
              <Txt variant="overline" color={colors.textFaint} style={{ marginBottom: spacing.md }}>
                Captured ({images.length})
              </Txt>

              {IMAGE_SIDES.filter((side) => countFor(side) > 0).map((side) => (
                <View key={side} style={{ marginBottom: spacing.lg }}>
                  <Row justify="space-between" style={{ marginBottom: spacing.sm }}>
                    <Row gap={spacing.xs}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                      <Txt variant="label" color={colors.textMuted}>
                        {imageSideLabels[side]}
                      </Txt>
                    </Row>
                    <Txt variant="caption" color={colors.textFaint}>
                      {countFor(side)} image{countFor(side) === 1 ? '' : 's'}
                    </Txt>
                  </Row>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Row gap={spacing.md} align="flex-start">
                      {images
                        .filter((image) => image.side === side)
                        .map((image) => (
                          <ImageThumb
                            key={image.id}
                            image={image}
                            onPress={() => setPreview(image)}
                            onRemove={() => confirmDelete(image)}
                          />
                        ))}
                    </Row>
                  </ScrollView>
                </View>
              ))}

              {missingRequired.length > 0 ? (
                <Row gap={spacing.sm} align="flex-start" style={styles.warn}>
                  <Ionicons name="alert-circle-outline" size={15} color={colors.warning} />
                  <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
                    {missingRequired.map((side) => imageSideLabels[side]).join(' and ')} not yet
                    captured. Most mandatory declarations sit on the back panel, and the analysis
                    can only report on what it is shown.
                  </Txt>
                </Row>
              ) : null}
            </>
          )}
        </View>
      </Body>

      <ActionBar>
        <Button
          title={images.length === 0 ? 'Capture at least one image' : 'Continue to Quality Check'}
          iconRight={images.length > 0 ? 'arrow-forward' : undefined}
          size="lg"
          fullWidth
          disabled={images.length === 0}
          onPress={onContinue}
        />
      </ActionBar>

      {/* Full-screen preview with retake / delete. */}
      <Modal visible={preview !== null} animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewScreen}>
          <Row justify="space-between" style={styles.previewHeader}>
            <Txt variant="heading" color={colors.textInverse}>
              {preview ? imageSideLabels[preview.side] : ''}
            </Txt>
            <Pressable
              onPress={() => setPreview(null)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close preview"
            >
              <Ionicons name="close" size={26} color={colors.textInverse} />
            </Pressable>
          </Row>

          <View style={styles.previewBody}>
            {preview?.uri ? (
              <Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="contain" />
            ) : (
              <Txt variant="body" color={colors.navyTint} center>
                No image data available for this capture.
              </Txt>
            )}
          </View>

          {preview ? (
            <View style={styles.previewFooter}>
              <Txt variant="caption" color={colors.navyTint} style={{ marginBottom: spacing.md }}>
                {formatRelative(preview.capturedAt)} ·{' '}
                {preview.source === 'camera' ? 'Camera' : 'Gallery'}
                {preview.fileSize ? ` · ${formatBytes(preview.fileSize)}` : ''}
              </Txt>

              <Row gap={spacing.md}>
                <Button
                  title="Replace"
                  icon="swap-horizontal-outline"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => {
                    const target = preview.id;
                    setPreview(null);
                    // Offers camera or gallery — an inspector may already have
                    // a usable photograph on the device.
                    void retakeFrom(target);
                  }}
                />
                <Button
                  title="Delete"
                  icon="trash-outline"
                  variant="danger"
                  style={{ flex: 1 }}
                  onPress={() => confirmDelete(preview)}
                />
              </Row>
            </View>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

const BRACKET = 18;

const styles = StyleSheet.create({
  faceTile: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  faceTileActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  faceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  target: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Brackets are absolutely placed rather than drawn as a dashed border: a
  // dashed box reads as a disabled drop zone, corners read as a viewfinder.
  corner: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
    borderColor: colors.navy,
  },
  cornerTL: {
    top: spacing.md,
    left: spacing.md,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderTopLeftRadius: 6,
  },
  cornerTR: {
    top: spacing.md,
    right: spacing.md,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderTopRightRadius: 6,
  },
  cornerBL: {
    bottom: spacing.md,
    left: spacing.md,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: spacing.md,
    right: spacing.md,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 6,
  },

  tip: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  warn: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  pending: { backgroundColor: colors.surfaceAlt },

  previewScreen: { flex: 1, backgroundColor: colors.navyDeep },
  previewHeader: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
  },
  previewBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
  },
  previewImage: { width: '100%', height: '100%', borderRadius: radius.md },
  previewFooter: { padding: spacing.base, paddingBottom: spacing.xxl },
});
