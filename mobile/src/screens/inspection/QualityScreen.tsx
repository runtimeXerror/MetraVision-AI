import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ImageThumb, QualityReport } from '../../components/domain';
import { ImageViewer } from '../../components/ImageViewer';
import { ActionBar, Body, Notice, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import { Badge, Button, Card, EmptyState, Row, Txt } from '../../components/ui';
import { imageSideLabels, qualityRatingLabels, qualityRatingTones } from '../../constants/labels';
import { colors, spacing } from '../../constants/theme';
import { useImageCapture } from '../../hooks/useImageCapture';
import { toApiError } from '../../services/api';
import { uploadImages } from '../../services/inspectionService';
import { useDraftStore } from '../../store/draftStore';
import { lowestQualityScore, useImageStore } from '../../store/imageStore';
import { useInspectionStore } from '../../store/inspectionStore';
import type { ApiError } from '../../types';

import { INSPECTION_STEPS } from './InspectionDetailsScreen';

/**
 * Step 3 — image quality review.
 *
 * Continuing is never blocked: a warning-grade photograph of a genuinely worn
 * label is still evidence, and the low-confidence review flow exists precisely
 * to catch what a poor capture costs downstream.
 */
export function QualityScreen() {
  // Recorded for the autosave, so an interrupted capture resumes on this
  // screen instead of sending the inspector back through steps they had
  // already completed.
  const setDraftStep = useDraftStore((state) => state.setStep);
  useEffect(() => setDraftStep('Quality'), [setDraftStep]);

  const navigation = useNavigation();

  const images = useImageStore((state) => state.images);
  const assessQuality = useImageStore((state) => state.assessQuality);
  const uploaded = useImageStore((state) => state.uploaded);
  const markUploaded = useImageStore((state) => state.markUploaded);
  const inspectionId = useInspectionStore((state) => state.id);
  const { retakeFrom, busy } = useImageCapture();

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(images[0]?.id ?? null);
  /** The selected photograph, full screen. See the control in the report header. */
  const [zoomed, setZoomed] = useState(false);
  const selected = images.find((image) => image.id === selectedId) ?? images[0];

  const worstScore = useMemo(() => lowestQualityScore(images), [images]);
  const needsAttention = worstScore < 0.8;

  const onRetake = async () => {
    if (!selected) return;
    // Asks camera or gallery. This screen is where a poor quality score sends
    // an inspector, and re-shooting is not always the fix — the better
    // photograph may already be on the phone.
    await retakeFrom(selected.id);
    // A fresh photograph invalidates the old assessment; re-run it.
    assessQuality();
  };

  /**
   * Uploads the captures, then advances.
   *
   * Deferred to this step rather than done at capture time so a retake does not
   * leave an orphaned upload on the server for every discarded shot.
   */
  const onContinue = async () => {
    if (!inspectionId) return;

    /**
     * Only what is not already on the server.
     *
     * This screen used to upload the whole set every time Continue was
     * pressed. Pressing back from Analysis and continuing again sent all of
     * them a second time, so a single photograph of the front face ended up on
     * the record two and three times over — and the report then counted images
     * the officer never took. A retry after a partial failure did the same to
     * whichever ones had already succeeded.
     */
    const outstanding = images.filter((image) => !uploaded[image.id]);

    if (outstanding.length === 0) {
      navigation.navigate('Analysis');
      return;
    }

    setUploading(true);
    setUploadError(null);
    setProgress({ done: 0, total: outstanding.length });

    try {
      const results = await uploadImages(inspectionId, outstanding, (done, total) =>
        setProgress({ done, total }),
      );

      // Recorded before navigating, so a back-and-continue finds them already
      // sent even though the screen was never unmounted.
      for (const result of results) markUploaded(result.localId, result.imageId);

      navigation.navigate('Analysis');
    } catch (error) {
      setUploadError(toApiError(error));
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  if (images.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Image Quality" onBack={() => navigation.goBack()} />
        <Body>
          <Card>
            <EmptyState
              icon="images-outline"
              title="No images to review"
              message="Go back and capture at least one photograph of the product label."
              action="Back to capture"
              onAction={() => navigation.goBack()}
            />
          </Card>
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Image Quality"
        subtitle="Step 3 of 5 · Review before analysis"
        onBack={() => navigation.goBack()}
      />
      <StepIndicator steps={INSPECTION_STEPS} current={2} />

      <Body>
        {images.length > 1 ? (
          <>
            <Txt variant="overline" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
              Select an image
            </Txt>
            <Row gap={spacing.md} wrap style={{ marginBottom: spacing.lg }}>
              {images.map((image) => (
                <ImageThumb
                  key={image.id}
                  image={image}
                  size={72}
                  selected={image.id === selected?.id}
                  onPress={() => setSelectedId(image.id)}
                />
              ))}
            </Row>
          </>
        ) : null}

        {selected?.quality ? (
          <Card>
            <Row justify="space-between" style={{ marginBottom: spacing.sm }}>
              {/* Tapping a thumbnail selects it — that is what drives this
                  report — so magnifying needs a control of its own rather than
                  a second meaning for the same tap. It belongs here anyway:
                  the officer is being asked whether this photograph is good
                  enough to read a declaration from, and they cannot answer that
                  from a 72-pixel square. */}
              <Pressable
                onPress={() => setZoomed(true)}
                accessibilityRole="button"
                accessibilityLabel="View this photograph full screen"
                hitSlop={8}
              >
                <Row gap={6} align="center">
                  <Txt variant="heading">{imageSideLabels[selected.side]}</Txt>
                  <Ionicons name="expand-outline" size={15} color={colors.accent} />
                </Row>
              </Pressable>
              <Badge
                label={
                  selected.quality.overallScore >= 0.9
                    ? 'Good'
                    : selected.quality.overallScore >= 0.75
                      ? 'Acceptable'
                      : 'Poor'
                }
                tone={
                  selected.quality.overallScore >= 0.9
                    ? 'success'
                    : selected.quality.overallScore >= 0.75
                      ? 'warning'
                      : 'danger'
                }
              />
            </Row>

            <QualityReport quality={selected.quality} />
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon="hourglass-outline"
              title="Quality not assessed"
              message="Return to the capture step and continue again to run the check."
              action="Back to capture"
              onAction={() => navigation.goBack()}
            />
          </Card>
        )}

        {images.length > 1 ? (
          <Card style={{ marginTop: spacing.md }}>
            <Txt variant="heading" style={{ marginBottom: spacing.sm }}>
              All captures
            </Txt>
            {images.map((image, index) => (
              <View key={image.id}>
                {index > 0 ? <View style={styles.hairline} /> : null}
                <Row justify="space-between" style={{ paddingVertical: spacing.md }}>
                  <Txt variant="body">{imageSideLabels[image.side]}</Txt>
                  {image.quality ? (
                    <Badge
                      label={qualityRatingLabels[image.quality.glare]}
                      tone={qualityRatingTones[image.quality.glare]}
                      size="sm"
                    />
                  ) : (
                    <Txt variant="caption" color={colors.textFaint}>
                      Not assessed
                    </Txt>
                  )}
                </Row>
              </View>
            ))}
          </Card>
        ) : null}

        <Notice
          tone={needsAttention ? 'warning' : 'info'}
          icon={needsAttention ? 'alert-circle-outline' : 'information-circle-outline'}
          text={
            needsAttention
              ? 'One or more captures scored below the recommended threshold. Retaking improves extraction confidence, but you can proceed if the label is genuinely worn.'
              : 'Quality is sufficient for analysis. Declarations should be extracted with high confidence.'
          }
          style={{ marginTop: spacing.md }}
        />

        {uploadError ? (
          <Notice
            tone="warning"
            icon="cloud-offline-outline"
            text={`${uploadError.message} Your captures are still on the device — tap Continue to try again.`}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}

        <Notice
          icon="flask-outline"
          text="Quality scores are assessed on the device and are indicative. The declaration analysis runs on the departmental server."
          style={{ marginTop: spacing.sm }}
        />
      </Body>

      <ActionBar>
        <Row gap={spacing.md}>
          <Button
            title="Replace"
            icon="swap-horizontal-outline"
            variant="secondary"
            size="lg"
            loading={busy}
            onPress={() => void onRetake()}
            style={{ flex: 1 }}
          />
          <Button
            title={
              progress ? `Uploading ${progress.done}/${progress.total}…` : 'Upload & Analyse'
            }
            iconRight={uploading ? undefined : 'arrow-forward'}
            size="lg"
            loading={uploading}
            disabled={!inspectionId}
            onPress={() => void onContinue()}
            style={{ flex: 1.4 }}
          />
        </Row>
      </ActionBar>

      {selected ? (
        <ImageViewer
          images={[selected]}
          visible={zoomed}
          onClose={() => setZoomed(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hairline: { height: 1, backgroundColor: colors.border },
});
