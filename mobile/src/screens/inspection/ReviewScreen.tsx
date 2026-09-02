import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ConfidencePill, EvidenceView } from '../../components/domain';
import { Input } from '../../components/forms';
import { ActionBar, Body, Notice, Screen, ScreenHeader } from '../../components/layout';
import { Badge, Button, Card, EmptyState, Row, Txt } from '../../components/ui';
import { colors, radius, spacing } from '../../constants/theme';
import { useImageCapture } from '../../hooks/useImageCapture';
import { fieldsNeedingReview, useAnalysisStore } from '../../store/analysisStore';
import { useImageStore } from '../../store/imageStore';
import { useInspectionStore } from '../../store/inspectionStore';
import type { ExtractedField, ReviewAction } from '../../types';
import { pluralize } from '../../utils/format';

/**
 * Human review.
 *
 * The inspector works through the uncertain declarations one at a time. Every
 * decision is written as `humanValue` + `reviewAction`; `aiValue` is never
 * touched, so the record always shows both what the model read and what the
 * inspector determined.
 */
export function ReviewScreen() {
  const navigation = useNavigation();

  const analysis = useAnalysisStore((state) => state.analysis);
  const reviewField = useAnalysisStore((state) => state.reviewField);
  const reanalyse = useAnalysisStore((state) => state.reanalyse);
  const reanalysing = useAnalysisStore((state) => state.reanalysing);
  const submitting = useAnalysisStore((state) => state.submitting);
  const reviewError = useAnalysisStore((state) => state.error);

  const inspectionId = useInspectionStore((state) => state.id);
  const images = useImageStore((state) => state.images);
  const { capture } = useImageCapture();

  const pending = useMemo(() => fieldsNeedingReview(analysis), [analysis]);
  const current: ExtractedField | undefined = pending[0];

  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);

  const total = analysis?.fields.length ?? 0;
  const decided = total - pending.length;

  const resetForm = () => {
    setDraft('');
    setComment('');
    setEditing(false);
  };

  /**
   * Posts one decision. The backend re-evaluates compliance and returns the
   * updated record, so the verdict is never computed in two places.
   */
  const submit = async (action: ReviewAction, value: string | null) => {
    if (!current || !inspectionId) return;

    const ok = await reviewField(
      inspectionId,
      current.key,
      action,
      value,
      comment.trim() || undefined,
    );

    if (ok) resetForm();
  };

  /** Captures a fresh photograph of the declaration and re-runs the analysis. */
  const uploadAnother = async () => {
    if (!current || !inspectionId) return;

    const before = useImageStore.getState().images.length;
    await capture('camera', 'additional');

    const after = useImageStore.getState().images;
    if (after.length > before) {
      const latest = after[after.length - 1];
      if (latest) await reanalyse(inspectionId, current.key, latest);
    }
  };

  if (!analysis) {
    return (
      <Screen>
        <ScreenHeader title="Review" onBack={() => navigation.goBack()} />
        <Body>
          <Card>
            <EmptyState
              icon="create-outline"
              title="Nothing to review"
              message="Run the analysis first to see which declarations need confirmation."
              action="Back"
              onAction={() => navigation.goBack()}
            />
          </Card>
        </Body>
      </Screen>
    );
  }

  // All decisions made — the completion state.
  if (!current) {
    return (
      <Screen>
        <ScreenHeader title="Review Complete" onBack={() => navigation.goBack()} />
        <Body>
          <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <View style={styles.doneIcon}>
              <Ionicons name="checkmark-done" size={28} color={colors.success} />
            </View>
            <Txt variant="heading" center style={{ marginTop: spacing.md }}>
              All declarations confirmed
            </Txt>
            <Txt variant="body" color={colors.textMuted} center style={{ marginTop: spacing.sm }}>
              Every uncertain field now carries an inspector decision. The model's original reads
              are preserved alongside your corrections.
            </Txt>
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Txt variant="heading" style={{ marginBottom: spacing.sm }}>
              Your decisions
            </Txt>
            {analysis.fields
              .filter((field) => field.reviewAction)
              .map((field, index) => (
                <View key={field.key}>
                  {index > 0 ? <View style={styles.hairline} /> : null}
                  <Row justify="space-between" style={{ paddingVertical: spacing.md }} gap={spacing.md}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{field.label}</Txt>
                      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                        {field.reviewAction === 'marked_unavailable'
                          ? 'Marked unavailable'
                          : (field.humanValue ?? field.aiValue ?? '—')}
                      </Txt>
                    </View>
                    <Badge
                      label={
                        field.reviewAction === 'accepted'
                          ? 'Accepted'
                          : field.reviewAction === 'edited'
                            ? 'Corrected'
                            : 'Unavailable'
                      }
                      tone={
                        field.reviewAction === 'accepted'
                          ? 'success'
                          : field.reviewAction === 'edited'
                            ? 'info'
                            : 'neutral'
                      }
                      size="sm"
                    />
                  </Row>
                </View>
              ))}
          </Card>
        </Body>

        <ActionBar>
          <Button
            title="Continue to Finalize"
            iconRight="arrow-forward"
            size="lg"
            fullWidth
            onPress={() => navigation.navigate('Finalize')}
          />
        </ActionBar>
      </Screen>
    );
  }

  const sourceImage = images.find((image) => image.id === current.sourceImageId);
  const missing = current.aiValue === null || current.aiValue.trim() === '';

  return (
    <Screen>
      <ScreenHeader
        title="Review Required"
        subtitle={`${decided} of ${total} declarations confirmed`}
        onBack={() => navigation.goBack()}
        right={<Badge label={`${pending.length} left`} tone="warning" size="sm" />}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <Body>
          <Notice
            tone="warning"
            icon="alert-circle-outline"
            text={
              missing
                ? 'This mandatory declaration was not found on any captured face. Confirm whether it is genuinely absent.'
                : 'This declaration was read with low confidence. Confirm the value against the package.'
            }
          />

          <Card style={{ marginTop: spacing.md }}>
            <Row justify="space-between" align="flex-start">
              <Txt variant="overline" color={colors.textFaint} style={{ flex: 1 }}>
                {current.label}
                {current.required ? ' · Required' : ''}
              </Txt>
              {!missing ? <ConfidencePill confidence={current.confidence} /> : null}
            </Row>

            <View style={styles.aiValue}>
              <Txt variant="overline" color={colors.textFaint}>
                AI result
              </Txt>
              <Txt
                variant="title"
                color={missing ? colors.danger : colors.text}
                style={{ marginTop: 3 }}
              >
                {missing ? 'Not declared' : current.aiValue}
              </Txt>
            </View>

            {current.boundingBox ? (
              <View style={{ marginTop: spacing.md }}>
                <Txt variant="overline" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
                  Evidence
                </Txt>
                <EvidenceView image={sourceImage} field={current} height={200} />
              </View>
            ) : null}
          </Card>

          {editing ? (
            <Card style={{ marginTop: spacing.md }}>
              <Txt variant="heading" style={{ marginBottom: spacing.md }}>
                Human corrected result
              </Txt>
              <Input
                label={current.label}
                placeholder="Enter the value printed on the package"
                value={draft}
                onChangeText={setDraft}
                autoFocus
              />
              <Row gap={spacing.md}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setEditing(false);
                    setDraft('');
                  }}
                />
                <Button
                  title="Save correction"
                  style={{ flex: 1.3 }}
                  loading={submitting}
                  disabled={draft.trim().length === 0}
                  onPress={() => void submit('edited', draft.trim())}
                />
              </Row>
            </Card>
          ) : (
            <Card style={{ marginTop: spacing.md }}>
              <Txt variant="heading" style={{ marginBottom: spacing.md }}>
                Your decision
              </Txt>

              <Button
                title="Accept AI value"
                icon="checkmark-circle-outline"
                variant="secondary"
                fullWidth
                loading={submitting}
                disabled={missing}
                onPress={() => void submit('accepted', current.aiValue)}
              />
              <Button
                title="Edit value"
                icon="create-outline"
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={() => {
                  setDraft(current.aiValue ?? '');
                  setEditing(true);
                }}
              />
              <Button
                title="Mark unavailable on package"
                icon="close-circle-outline"
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={() => void submit('marked_unavailable', null)}
              />
              <Button
                title="Upload another image"
                icon="camera-outline"
                variant="secondary"
                fullWidth
                loading={reanalysing === current.key}
                style={{ marginTop: spacing.sm }}
                onPress={() => void uploadAnother()}
              />
            </Card>
          )}

          <Card style={{ marginTop: spacing.md }}>
            <Input
              label="Comment (optional)"
              placeholder="Why this decision was made — e.g. print worn, declaration on inner wrapper"
              value={comment}
              onChangeText={setComment}
              multiline
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {reviewError ? (
            <Notice
              tone="warning"
              icon="cloud-offline-outline"
              text={`${reviewError.message} Your decision was not saved — try again.`}
              style={{ marginTop: spacing.md }}
            />
          ) : null}

          <Notice
            icon="shield-outline"
            text="The model's original reading is retained on the record alongside your correction. Both are stored on the server and carried into the report."
            style={{ marginTop: spacing.md }}
          />
        </Body>
      </KeyboardAvoidingView>

      {!editing ? (
        <ActionBar>
          <Row gap={spacing.md}>
            <Button
              title="Back to result"
              variant="secondary"
              size="lg"
              style={{ flex: 1 }}
              onPress={() => navigation.goBack()}
            />
            <Button
              title={`${pluralize(pending.length, 'field')} left`}
              variant="ghost"
              size="lg"
              disabled
              style={{ flex: 1 }}
            />
          </Row>
        </ActionBar>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  aiValue: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairline: { height: 1, backgroundColor: colors.border },
});
