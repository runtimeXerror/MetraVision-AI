import { Ionicons } from '@expo/vector-icons';
import { StackActions, useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ComplianceBadge, ImageThumb } from '../../components/domain';
import { ImageViewer } from '../../components/ImageViewer';
import { Input } from '../../components/forms';
import { ActionBar, Body, Screen, ScreenHeader } from '../../components/layout';
import { Button, Card, EmptyState, Row, SectionHeader, Txt } from '../../components/ui';
import { productCategoryLabels } from '../../constants/labels';
import { colors, radius, spacing } from '../../constants/theme';
import { toApiError } from '../../services/api';
import { finalizeInspection } from '../../services/inspectionService';
import { effectiveValue, useAnalysisStore } from '../../store/analysisStore';
import { useAuthStore } from '../../store/authStore';
import { useHistoryStore } from '../../store/historyStore';
import { useImageStore } from '../../store/imageStore';
import { useDraftStore } from '../../store/draftStore';
import { useInspectionStore } from '../../store/inspectionStore';
import { formatDateTime } from '../../utils/format';

/** Final confirmation before the inspection becomes a record. */
export function FinalizeScreen() {
  const navigation = useNavigation();

  /** Which evidence photograph the full-screen viewer opens on; `null` is closed. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const inspector = useAuthStore((state) => state.inspector);
  const analysis = useAnalysisStore((state) => state.analysis);
  const images = useImageStore((state) => state.images);
  const resetImages = useImageStore((state) => state.reset);
  const resetAnalysis = useAnalysisStore((state) => state.reset);

  const draft = useInspectionStore((state) => state);
  const finalNotes = useInspectionStore((state) => state.finalNotes);
  const setFinalNotes = useInspectionStore((state) => state.setFinalNotes);
  const resetDraft = useInspectionStore((state) => state.reset);

  const refreshHistory = useHistoryStore((state) => state.refreshAll);
  const completeDraft = useDraftStore((state) => state.complete);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  if (!analysis || !draft.id || !draft.referenceId || !inspector) {
    return (
      <Screen>
        <ScreenHeader title="Finalize" onBack={() => navigation.goBack()} />
        <Body>
          <Card>
            <EmptyState
              icon="document-text-outline"
              title="Inspection incomplete"
              message="Complete the capture and analysis steps before finalizing."
              action="Back"
              onAction={() => navigation.goBack()}
            />
          </Card>
        </Body>
      </Screen>
    );
  }

  const { compliance } = analysis;

  const onFinalize = async () => {
    const inspectionId = draft.id;
    if (!inspectionId) return;

    setSubmitting(true);
    setError(undefined);

    try {
      const finalized = await finalizeInspection(inspectionId, finalNotes.trim() || undefined);

      // Refresh the read model so History and Home show the filed record.
      await refreshHistory();

      const status = finalized.complianceStatus ?? compliance.status;

      // Clear the per-inspection stores so the next flow starts clean, then
      // replace the route so Back cannot return to a submitted draft.
      //
      // The saved draft goes with them. This is one of only two places it is
      // ever deleted — the inspection it recorded is now filed, so re-offering
      // it on the next launch would invite the officer to capture the same
      // package twice.
      await completeDraft();
      resetDraft();
      resetImages();
      resetAnalysis();

      navigation.dispatch(
        StackActions.replace('Success', {
          inspectionId: finalized.id,
          referenceId: finalized.referenceId,
          status,
        }),
      );
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setSubmitting(false);
    }
  };

  const declared = analysis.fields.filter((field) => effectiveValue(field) !== null);

  return (
    <Screen>
      <ScreenHeader
        title="Inspection Summary"
        subtitle={draft.referenceId}
        onBack={() => navigation.goBack()}
        right={<ComplianceBadge status={compliance.status} size="sm" />}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <Body>
          {/* Business */}
          <SectionHeader title="Business" style={{ marginTop: spacing.lg }} />
          <Card>
            <SummaryRow label="Business / shop" value={draft.details.businessName} />
            <View style={styles.hairline} />
            <SummaryRow label="Location" value={draft.details.location} />
            <View style={styles.hairline} />
            <SummaryRow label="Inspected at" value={formatDateTime(draft.createdAt)} />
            <View style={styles.hairline} />
            <SummaryRow label="Inspector" value={`${inspector.name} · ${inspector.employeeId}`} />
          </Card>

          {/* Product */}
          <SectionHeader title="Product" style={{ marginTop: spacing.xl }} />
          <Card>
            <SummaryRow
              label="Category"
              value={productCategoryLabels[draft.details.productCategory ?? analysis.category]}
            />
            <View style={styles.hairline} />
            <SummaryRow label="Product" value={draft.details.productName || 'Not specified'} />
            <View style={styles.hairline} />
            <SummaryRow label="Origin" value={analysis.origin === 'imported' ? 'Imported' : 'Domestic'} />
          </Card>

          {/* Images */}
          <SectionHeader title={`Images (${images.length})`} style={{ marginTop: spacing.xl }} />
          {images.length === 0 ? (
            <Card>
              <Txt variant="caption" color={colors.textMuted}>
                No images attached.
              </Txt>
            </Card>
          ) : (
            <Row gap={spacing.md} wrap>
              {images.map((image, position) => (
                <ImageThumb
                  key={image.id}
                  image={image}
                  size={72}
                  onPress={() => setViewerIndex(position)}
                />
              ))}
            </Row>
          )}

          {/* Extracted information */}
          <SectionHeader
            title={`Extracted Information (${declared.length}/${analysis.fields.length})`}
            style={{ marginTop: spacing.xl }}
          />
          <Card>
            {analysis.fields.map((field, index) => {
              const value = effectiveValue(field);
              return (
                <View key={field.key}>
                  {index > 0 ? <View style={styles.hairline} /> : null}
                  <Row justify="space-between" gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="caption" color={colors.textMuted}>
                        {field.label}
                      </Txt>
                      <Txt
                        variant="bodyStrong"
                        color={value === null ? colors.danger : colors.text}
                        style={{ marginTop: 2 }}
                      >
                        {value ?? 'Not declared'}
                      </Txt>
                    </View>
                    {field.reviewAction ? (
                      <Ionicons name="person-circle" size={17} color={colors.info} />
                    ) : null}
                  </Row>
                </View>
              );
            })}
          </Card>

          {/* Issues */}
          <SectionHeader
            title={`Issues (${compliance.violations.length})`}
            style={{ marginTop: spacing.xl }}
          />
          <Card>
            {compliance.violations.length === 0 ? (
              <Row gap={spacing.sm}>
                <Ionicons name="shield-checkmark" size={17} color={colors.success} />
                <Txt variant="body" color={colors.textMuted}>
                  No violations detected.
                </Txt>
              </Row>
            ) : (
              compliance.violations.map((violation, index) => (
                <View key={violation.id}>
                  {index > 0 ? <View style={styles.hairline} /> : null}
                  <Row align="flex-start" gap={spacing.sm} style={{ paddingVertical: spacing.md }}>
                    <Ionicons name="alert-circle" size={17} color={colors.danger} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{violation.title}</Txt>
                      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                        {violation.ruleReference} · {violation.severity}
                      </Txt>
                    </View>
                  </Row>
                </View>
              ))
            )}
          </Card>

          {/* Notes */}
          <SectionHeader title="Inspector Notes" style={{ marginTop: spacing.xl }} />
          {draft.details.inspectorNotes ? (
            <Card style={{ marginBottom: spacing.md }}>
              <Txt variant="overline" color={colors.textFaint}>
                Recorded at intake
              </Txt>
              <Txt variant="body" style={{ marginTop: 4 }}>
                {draft.details.inspectorNotes}
              </Txt>
            </Card>
          ) : null}

          <Card>
            <Input
              label="Closing remarks"
              placeholder="Action taken, samples retained, notice issued…"
              value={finalNotes}
              onChangeText={setFinalNotes}
              multiline
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* Final status */}
          <SectionHeader title="Final Status" style={{ marginTop: spacing.xl }} />
          <Card style={styles.statusCard}>
            <Row justify="space-between">
              <View style={{ flex: 1 }}>
                <ComplianceBadge status={compliance.status} />
                <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
                  Compliance score {compliance.score}% · assessed against {compliance.ruleSetLabel}
                </Txt>
              </View>
            </Row>
          </Card>

          {error ? (
            <Card style={{ marginTop: spacing.md, backgroundColor: colors.dangerSoft }}>
              <Row align="flex-start" gap={spacing.sm}>
                <Ionicons name="alert-circle" size={17} color={colors.danger} style={{ marginTop: 1 }} />
                <Txt variant="caption" color={colors.danger} style={{ flex: 1 }}>
                  {error}
                </Txt>
              </Row>
            </Card>
          ) : null}
        </Body>
      </KeyboardAvoidingView>

      <ActionBar>
        <Button
          title="Finalize Inspection"
          icon="checkmark-done"
          size="lg"
          fullWidth
          loading={submitting}
          onPress={() => void onFinalize()}
        />
      </ActionBar>

      <ImageViewer
        images={images}
        startIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justify="space-between" gap={spacing.md} style={{ paddingVertical: spacing.md }}>
      <Txt variant="caption" color={colors.textMuted}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" style={{ flex: 1, textAlign: 'right' }} numberOfLines={2}>
        {value}
      </Txt>
    </Row>
  );
}

const styles = StyleSheet.create({
  hairline: { height: 1, backgroundColor: colors.border },
  statusCard: {
    backgroundColor: colors.navyTint,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
});
