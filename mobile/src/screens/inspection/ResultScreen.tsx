import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  CheckRow,
  ComplianceBadge,
  EvidenceView,
  ExtractedFieldCard,
  ComplianceTally,
  ConfidencePill,
  VerdictPanel,
  ViolationCard,
} from '../../components/domain';
import { ActionBar, Body, Notice, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import {
  Badge,
  Button,
  Card,
  ChipBar,
  Disclosure,
  EmptyState,
  Row,
  Txt,
} from '../../components/ui';
import { IssueCard } from '../../components/legal';
import { productCategoryLabels } from '../../constants/labels';
import { colors, radius, spacing } from '../../constants/theme';
import { fieldsNeedingReview, useAnalysisStore } from '../../store/analysisStore';
import { imageForRemoteId, useImageStore } from '../../store/imageStore';
import { useInspectionStore } from '../../store/inspectionStore';
import type { ExtractedField } from '../../types';
import { formatConfidence, formatDuration, pluralize } from '../../utils/format';

import { INSPECTION_STEPS } from './InspectionDetailsScreen';

type Tab = 'fields' | 'issues' | 'checks';

/**
 * Step 5 — the compliance result.
 *
 * Three verdicts, never a binary pass/fail: `review_required` is what the
 * system reports when it is not confident enough to assert either of the
 * others, and that distinction is the whole reason the review flow exists.
 *
 * ── WHAT IS ON THE SCREEN, AND WHAT IS ONE TAP AWAY ─────────────────────────
 *
 * This screen has to carry everything a finding could be challenged on — the
 * rule set version, the confidence a value was read at, the engine's own
 * counts, the disclaimer the screening is issued subject to. Laid out flat
 * that was seven cards stacked above the content, and the content is the part
 * an inspector came for.
 *
 * So the top of the screen answers three questions and stops:
 *
 *   1. What is the verdict?            — the panel
 *   2. What did it look at?            — one strip of counts
 *   3. What do I have to do about it?  — the review banner, when there is one
 *
 * Everything else is folded into `Scan details` and `About this screening`.
 * Nothing is dropped; a disclosure states its own count, so an inspector can
 * see there are notes without having to read them first.
 *
 * The two exceptions that stay unfolded are the ones that change how the
 * result should be read at all: a demonstration reading, and a package only
 * partly captured. Those are warnings about the evidence itself, and a warning
 * behind a chevron is a warning nobody sees.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function ResultScreen() {
  const navigation = useNavigation();

  const analysis = useAnalysisStore((state) => state.analysis);
  const scan = useAnalysisStore((state) => state.scan);
  const images = useImageStore((state) => state.images);
  // The local-id → server-id map; `imageForRemoteId` needs both.
  const uploaded = useImageStore((state) => state.uploaded);
  const details = useInspectionStore((state) => state.details);

  const [tab, setTab] = useState<Tab>('fields');
  const [evidenceFor, setEvidenceFor] = useState<ExtractedField | null>(null);

  const pending = useMemo(() => fieldsNeedingReview(analysis), [analysis]);

  if (!analysis) {
    return (
      <Screen>
        <ScreenHeader title="Result" onBack={() => navigation.goBack()} />
        <Body>
          <Card>
            <EmptyState
              icon="analytics-outline"
              title="No analysis available"
              message="Run the analysis step to see extracted declarations and the compliance verdict."
              action="Back"
              onAction={() => navigation.goBack()}
            />
          </Card>
        </Body>
      </Screen>
    );
  }

  const { compliance } = analysis;
  const evidenceImage = evidenceFor
    ? imageForRemoteId(evidenceFor.sourceImageId, images, uploaded)
    : undefined;

  // The engine's own issue list where a scan produced one, and the three-state
  // projection otherwise — a record from the older workflow still has to render.
  const issues = scan?.issues ?? [];
  const issueCount = scan ? issues.length : compliance.violations.length;
  const partialCapture = scan !== null && scan.captureCompleteness < 0.7;

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'fields', label: 'Declarations', count: analysis.fields.length },
    { value: 'issues', label: 'Findings', count: issueCount },
    { value: 'checks', label: 'Rule checks', count: compliance.checks.length },
  ];

  return (
    <Screen>
      <ScreenHeader
        title="Compliance Result"
        subtitle="Step 5 of 5 · Review findings"
        onBack={() => navigation.goBack()}
        right={<ComplianceBadge status={compliance.status} size="sm" />}
      />
      <StepIndicator steps={INSPECTION_STEPS} current={4} />

      <Body>
        <VerdictPanel status={compliance.status} ruleSetLabel={compliance.ruleSetLabel} />

        {/* The counts the removed percentage was standing in for. See the note
            at `VerdictPanel` — "67%" could not say what it was 67% of, and
            these three numbers can. */}
        <ComplianceTally analysis={analysis} />

        {/* The four-count strip that stood here — Passed, Findings, To review,
            Checks — said the same thing as the tally above it, in a second
            visual language, immediately below. Two summaries of one scan stacked
            on each other is not twice the information; it is the reader having
            to work out whether they disagree. */}

        {/*
          The one thing on this screen that is an instruction rather than a
          statement, so it is the only thing styled as one.
        */}
        {/*
          ── WHICH DECLARATIONS, NOT HOW MANY ────────────────────────────

          This was a banner reading "Your review is needed — 3 declarations
          could not be read confidently enough to stand alone", and then a
          chevron into a flow that shows them one at a time. An officer could
          not see what they were being asked about until they were already
          inside it, and could not tell a two-second job (confirm an MRP that
          is plainly right) from a real one (a date that needs the packet
          turning over) before committing to it.

          So the declarations are named here. Each row is what the recogniser
          read and how sure it was, which is exactly the material the decision
          turns on, and each opens the review at that field. The count is in the
          heading where a count belongs.
        */}
        {pending.length > 0 ? (
          <View style={styles.reviewBlock}>
            <Row gap={spacing.sm} align="center" style={{ marginBottom: spacing.sm }}>
              <Ionicons name="create-outline" size={16} color={colors.warning} />
              <Txt variant="bodyStrong" style={{ flex: 1 }}>
                {pluralize(pending.length, 'declaration')} need your review
              </Txt>
            </Row>

            {pending.map((field, index) => (
              <Pressable
                key={field.key}
                onPress={() => navigation.navigate('Review')}
                accessibilityRole="button"
                accessibilityLabel={`Review ${field.label}`}
                style={({ pressed }) => [styles.reviewRow, pressed && { opacity: 0.7 }]}
              >
                <Txt variant="caption" color={colors.textFaint} style={{ width: 18 }}>
                  {index + 1}
                </Txt>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{field.label}</Txt>
                  <Txt variant="caption" color={colors.textMuted} numberOfLines={1}>
                    {field.aiValue
                      ? `Read as "${field.aiValue}"`
                      : 'Not found on the photographs taken'}
                  </Txt>
                </View>
                <ConfidencePill confidence={field.confidence} />
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/*
          Unfolded on purpose. Both of these say the result should be read
          differently, and neither survives being put behind a chevron.
        */}
        {scan?.ocr.provider === 'mock' ? (
          <Notice
            tone="warning"
            icon="flask-outline"
            text="Demonstration reading. No OCR ran on these photographs — the declarations below come from a sample label, not from this package. Set OCR_PROVIDER on the server to read the real thing."
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        {partialCapture ? (
          <Notice
            tone="warning"
            icon="camera-outline"
            text="Only part of the package was captured. A declaration that was not found has been sent for review rather than recorded as missing — photograph the remaining faces to settle it."
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        {/* Everything an inspector may need and does not need in front of them. */}
        <Disclosure
          title="Scan details"
          icon="options-outline"
          style={{ marginTop: spacing.md }}
        >
          <Detail label="Product category" value={productCategoryLabels[analysis.category]} />
          {details.productName ? <Detail label="Product" value={details.productName} /> : null}
          <Detail label="Origin" value={analysis.origin === 'imported' ? 'Imported' : 'Domestic'} />
          <Detail label="Mean confidence" value={formatConfidence(analysis.meanConfidence)} />
          <Detail label="Photographs read" value={`${analysis.imageIds.length}`} />
          <Detail label="Processing time" value={formatDuration(analysis.processingMs)} />
          <Detail label="Rule set" value={scan ? scan.ruleSetVersion : compliance.ruleSetId} />
          {scan && scan.summary.notApplicable > 0 ? (
            <Detail label="Not applicable" value={`${scan.summary.notApplicable} checks`} />
          ) : null}
          {scan && scan.summary.pendingCapability > 0 ? (
            <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
              {pluralize(scan.summary.pendingCapability, 'check')} need the printed text measured in
              millimetres, which a photograph alone cannot give — check the font size against the
              package itself.
            </Txt>
          ) : null}
        </Disclosure>

        {compliance.warnings.length > 0 ? (
          <Disclosure
            title="Notes on this reading"
            count={compliance.warnings.length}
            icon="alert-circle-outline"
            tone="warning"
            style={{ marginTop: spacing.sm }}
          >
            {compliance.warnings.map((warning) => (
              <Row key={warning} align="flex-start" gap={spacing.sm} style={{ marginTop: spacing.xs }}>
                <Txt variant="caption" color={colors.textMuted}>
                  ·
                </Txt>
                <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                  {warning}
                </Txt>
              </Row>
            ))}
          </Disclosure>
        ) : null}

        {/* ── The content ─────────────────────────────────────────────────── */}

        <View style={{ marginTop: spacing.xl, marginHorizontal: -spacing.base }}>
          <ChipBar<Tab> options={tabs} value={tab} onChange={setTab} />
        </View>

        <View style={{ marginTop: spacing.base }}>
          {tab === 'fields' ? (
            analysis.fields.map((field) => (
              <ExtractedFieldCard
                key={field.key}
                field={field}
                onViewEvidence={() => setEvidenceFor(field)}
                onReview={() => navigation.navigate('Review')}
              />
            ))
          ) : tab === 'issues' ? (
            scan ? (
              issues.length === 0 ? (
                <Card>
                  <EmptyState
                    icon="shield-checkmark-outline"
                    title="No issues raised by the checks performed"
                    // Deliberately not "the package is compliant". The system
                    // checked what it can check, and said so.
                    message={`${scan.summary.compliant} of ${scan.summary.totalChecks} checks passed and none raised an issue. This is not a finding that the package meets every legal requirement.`}
                  />
                </Card>
              ) : (
                issues.map((issue) => <IssueCard key={issue.issueId} issue={issue} />)
              )
            ) : compliance.violations.length === 0 ? (
              <Card>
                <EmptyState
                  icon="shield-checkmark-outline"
                  title="No issues detected"
                  message="No mandatory declaration for this category was found missing."
                />
              </Card>
            ) : (
              compliance.violations.map((violation, position) => (
                <ViolationCard key={violation.id} violation={violation} index={position + 1} />
              ))
            )
          ) : (
            <Card>
              {compliance.checks.map((check, index) => (
                <View key={check.code}>
                  {index > 0 ? <View style={styles.hairline} /> : null}
                  <CheckRow
                    index={index + 1}
                    title={check.title}
                    ruleReference={check.ruleReference}
                    result={check.result}
                    message={check.message}
                  />
                </View>
              ))}
            </Card>
          )}
        </View>

        <Disclosure
          title="About this screening"
          icon="information-circle-outline"
          style={{ marginTop: spacing.lg }}
        >
          <Txt variant="caption" color={colors.textMuted}>
            {scan
              ? `Automated screening. The system reads the submitted photographs and checks them against the rules it implements (${scan.ruleSetVersion}). Results should be reviewed by an authorized inspector where evidence is incomplete or uncertain. This is not a determination that the package complies with every legal requirement.`
              : 'Automated screening. Results should be reviewed by an authorized inspector where evidence is incomplete or uncertain.'}
          </Txt>
          <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
            Assessed against {compliance.ruleSetLabel}.
          </Txt>
        </Disclosure>
      </Body>

      <ActionBar>
        <Row gap={spacing.md}>
          {pending.length > 0 ? (
            <Button
              title="Review"
              icon="create-outline"
              variant="secondary"
              size="lg"
              onPress={() => navigation.navigate('Review')}
              style={{ flex: 1 }}
            />
          ) : null}
          <Button
            title="Continue to Finalize"
            iconRight="arrow-forward"
            size="lg"
            onPress={() => navigation.navigate('Finalize')}
            style={{ flex: 1.5 }}
          />
        </Row>
      </ActionBar>

      {/* Evidence viewer */}
      <Modal
        visible={evidenceFor !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEvidenceFor(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setEvidenceFor(null)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.grabber} />

            {evidenceFor ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Row justify="space-between" style={{ marginBottom: spacing.md }}>
                  <Txt variant="heading">{evidenceFor.label}</Txt>
                  <Badge
                    label={formatConfidence(evidenceFor.confidence)}
                    tone={evidenceFor.confidence >= 0.75 ? 'success' : 'warning'}
                    size="sm"
                  />
                </Row>

                <EvidenceView image={evidenceImage} field={evidenceFor} />

                <Card flat style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt }}>
                  <Txt variant="overline" color={colors.textFaint}>
                    Value read
                  </Txt>
                  <Txt variant="bodyStrong" style={{ marginTop: 3 }}>
                    {evidenceFor.aiValue ?? 'Not declared'}
                  </Txt>
                </Card>

                <Button
                  title="Close"
                  variant="secondary"
                  fullWidth
                  onPress={() => setEvidenceFor(null)}
                  style={{ marginTop: spacing.md }}
                />
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

/** One `label · value` line inside a disclosure. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Row justify="space-between" align="flex-start" gap={spacing.md} style={{ paddingVertical: 5 }}>
      <Txt variant="caption" color={colors.textMuted}>
        {label}
      </Txt>
      <Txt variant="caption" color={colors.text} style={{ flex: 1, textAlign: 'right' }}>
        {value}
      </Txt>
    </Row>
  );
}

const styles = StyleSheet.create({
  /**
   * The review block.
   *
   * Amber only at the edge, not as a fill. It is the one instruction on a page
   * of statements and has to be findable, but it sits directly under a verdict
   * panel that is already carrying a full-strength tone — two saturated blocks
   * in a row and neither reads as more urgent than the other.
   */
  reviewBlock: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  reviewIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairline: { height: 1, backgroundColor: colors.border },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
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
});
