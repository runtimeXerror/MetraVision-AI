import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ConfidencePill, EvidenceView } from '../../components/domain';
import { Input } from '../../components/forms';
import { ActionBar, Body, Notice, Screen, ScreenHeader } from '../../components/layout';
import { Badge, Button, Card, Disclosure, EmptyState, Row, Txt } from '../../components/ui';
import { colors, radius, spacing } from '../../constants/theme';
import { useImageCapture } from '../../hooks/useImageCapture';
import { fieldsNeedingReview, useAnalysisStore } from '../../store/analysisStore';
import { imageForRemoteId, useImageStore } from '../../store/imageStore';
import { useInspectionStore } from '../../store/inspectionStore';
import type { ExtractedField, ReviewAction } from '../../types';

/**
 * Human review.
 *
 * The inspector works through the uncertain declarations one at a time. Every
 * decision is written as `humanValue` + `reviewAction`; `aiValue` is never
 * touched, so the record always shows both what the model read and what the
 * inspector determined.
 *
 * ── ONE QUESTION, ONE ANSWER ────────────────────────────────────────────────
 *
 * This screen asks the same thing every time — *is this what the package
 * says?* — and it used to present that as four full-width buttons of identical
 * weight, under two cards and above three more. Four equal options is not a
 * choice, it is a menu to be read; and the commonest answer by far, "yes, that
 * is what it says", was the third of them.
 *
 * So the layout follows the shape of the decision. What was read is the
 * largest thing on the screen, with the photograph it was read from directly
 * under it, because the answer is on the package and not in this app. Accept
 * is the one primary button. The three less common answers — correct it, it
 * is genuinely not printed, take a better photograph — sit in a row beneath,
 * where they are one tap away and not competing.
 *
 * The note field and the provenance explanation are folded away. Neither is
 * needed to answer the question, and both were being scrolled past.
 * ────────────────────────────────────────────────────────────────────────────
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
  // The local-id → server-id map; `imageForRemoteId` needs both.
  const uploaded = useImageStore((state) => state.uploaded);
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
              Every uncertain field now carries an inspector decision. The model&apos;s original
              reads are preserved alongside your corrections.
            </Txt>
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Txt variant="overline" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
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

  const sourceImage = imageForRemoteId(current.sourceImageId, images, uploaded);
  const missing = current.aiValue === null || current.aiValue.trim() === '';

  return (
    <Screen>
      <ScreenHeader
        title="Confirm declaration"
        subtitle={`${decided + 1} of ${total}`}
        onBack={() => navigation.goBack()}
        right={<Badge label={`${pending.length} left`} tone="warning" size="sm" />}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <Body>
          {/*
            The question, the reading, and the photograph it came from — one
            card, in that order. An inspector answers this by looking at the
            package, so the fastest thing this screen can do is show them
            exactly which words on which photograph are in doubt.
          */}
          <Card>
            <Row justify="space-between" align="center" gap={spacing.sm}>
              <Row gap={spacing.sm} style={{ flex: 1 }}>
                <Txt variant="overline" color={colors.textFaint}>
                  {current.label}
                </Txt>
                {current.required ? <Badge label="Required" tone="neutral" size="sm" /> : null}
              </Row>
              {!missing ? <ConfidencePill confidence={current.confidence} /> : null}
            </Row>

            <View style={[styles.reading, missing && styles.readingMissing]}>
              <Txt variant="overline" color={colors.textFaint}>
                {missing ? 'Not found on any captured face' : 'Read from the package'}
              </Txt>
              <Txt
                variant="title"
                color={missing ? colors.danger : colors.text}
                style={{ marginTop: 4 }}
              >
                {missing ? 'Not declared' : current.aiValue}
              </Txt>
            </View>

            {current.boundingBox ? (
              <View style={{ marginTop: spacing.md }}>
                <EvidenceView image={sourceImage} field={current} height={200} />
              </View>
            ) : null}

            <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
              {missing
                ? 'Check the package itself before confirming. A declaration printed on a face that was not photographed is not a missing declaration.'
                : 'Check this against the package. If it matches, accept it.'}
            </Txt>
          </Card>

          {editing ? (
            <Card style={{ marginTop: spacing.md }}>
              <Txt variant="overline" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
                As printed on the package
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
                  title="Save"
                  style={{ flex: 1.3 }}
                  loading={submitting}
                  disabled={draft.trim().length === 0}
                  onPress={() => void submit('edited', draft.trim())}
                />
              </Row>
            </Card>
          ) : (
            <>
              {/* The answer that is right most of the time, sized accordingly. */}
              <Button
                title="Accept — this is what it says"
                icon="checkmark-circle"
                size="lg"
                fullWidth
                loading={submitting}
                disabled={missing}
                style={{ marginTop: spacing.md }}
                onPress={() => void submit('accepted', current.aiValue)}
              />

              {/* The three less common answers, equal to each other and quieter. */}
              <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
                <Choice
                  icon="create-outline"
                  label="Correct it"
                  onPress={() => {
                    setDraft(current.aiValue ?? '');
                    setEditing(true);
                  }}
                />
                <Choice
                  icon="close-circle-outline"
                  label="Not on pack"
                  onPress={() => void submit('marked_unavailable', null)}
                />
                <Choice
                  icon="camera-outline"
                  label="Re-photograph"
                  busy={reanalysing === current.key}
                  onPress={() => void uploadAnother()}
                />
              </Row>
            </>
          )}

          <Disclosure title="Add a note" icon="chatbox-outline" style={{ marginTop: spacing.md }}>
            <Input
              label="Why this decision was made"
              placeholder="e.g. print worn, declaration on inner wrapper"
              value={comment}
              onChangeText={setComment}
              multiline
              containerStyle={{ marginBottom: 0 }}
            />
          </Disclosure>

          {reviewError ? (
            <Notice
              tone="warning"
              icon="cloud-offline-outline"
              text={`${reviewError.message} Your decision was not saved — try again.`}
              style={{ marginTop: spacing.md }}
            />
          ) : null}

          <Row gap={spacing.sm} align="center" style={{ marginTop: spacing.lg }}>
            <Ionicons name="shield-outline" size={13} color={colors.textFaint} />
            <Txt variant="caption" color={colors.textFaint} style={{ flex: 1 }}>
              What the model read is kept on the record beside your decision.
            </Txt>
          </Row>
        </Body>
      </KeyboardAvoidingView>

      {!editing ? (
        <ActionBar>
          <Button
            title="Back to result"
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => navigation.goBack()}
          />
        </ActionBar>
      ) : null}
    </Screen>
  );
}

/**
 * One of the three secondary answers.
 *
 * A tile rather than a button because they are a set: three equal alternatives
 * to the primary, and rendering them as three more buttons is what made the
 * decision read as a list of four indistinguishable options.
 */
function Choice({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.choice, pressed && { backgroundColor: colors.navyTint }]}
    >
      <Ionicons
        name={busy ? 'hourglass-outline' : icon}
        size={19}
        color={colors.navy}
      />
      <Txt variant="caption" color={colors.navy} center style={{ marginTop: 5 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reading: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readingMissing: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },
  choice: {
    flex: 1,
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
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
