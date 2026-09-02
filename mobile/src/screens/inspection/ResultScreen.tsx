import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  CheckRow,
  ComplianceBadge,
  EvidenceView,
  ExtractedFieldCard,
  VerdictPanel,
  ViolationCard,
} from '../../components/domain';
import { ActionBar, Body, Notice, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import { Badge, Button, Card, ChipBar, EmptyState, Row, SectionHeader, Txt } from '../../components/ui';
import { IssueCard, LegalSummaryCard } from '../../components/legal';
import { productCategoryLabels } from '../../constants/labels';
import { colors, spacing } from '../../constants/theme';
import { fieldsNeedingReview, useAnalysisStore } from '../../store/analysisStore';
import { useImageStore } from '../../store/imageStore';
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
 */
export function ResultScreen() {
  const navigation = useNavigation();

  const analysis = useAnalysisStore((state) => state.analysis);
  const scan = useAnalysisStore((state) => state.scan);
  const images = useImageStore((state) => state.images);
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
    ? images.find((image) => image.id === evidenceFor.sourceImageId)
    : undefined;

  // The engine's own issue list where a scan produced one, and the three-state
  // projection otherwise — a record from the older workflow still has to render.
  const issues = scan?.issues ?? [];

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'fields', label: 'Extracted', count: analysis.fields.length },
    {
      value: 'issues',
      label: 'Issues',
      count: scan ? issues.length : compliance.violations.length,
    },
    { value: 'checks', label: 'Rule Checks', count: compliance.checks.length },
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
        <VerdictPanel
          status={compliance.status}
          score={compliance.score}
          ruleSetLabel={compliance.ruleSetLabel}
        />

        {/* Product identification */}
        <Card style={{ marginTop: spacing.md }}>
          <Row justify="space-between" align="flex-start">
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Txt variant="overline" color={colors.textFaint}>
                Product category
              </Txt>
              <Txt variant="heading" style={{ marginTop: 3 }}>
                {productCategoryLabels[analysis.category]}
              </Txt>
              {details.productName ? (
                <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                  {details.productName}
                </Txt>
              ) : null}
            </View>
            <Badge
              label={formatConfidence(analysis.categoryConfidence)}
              tone={analysis.categoryConfidence >= 0.85 ? 'success' : 'warning'}
              size="sm"
              icon="pricetag-outline"
            />
          </Row>

          <Row justify="space-between" style={styles.metaRow} wrap gap={spacing.md}>
            <MetaItem label="Mean confidence" value={formatConfidence(analysis.meanConfidence)} />
            <MetaItem label="Processing" value={formatDuration(analysis.processingMs)} />
            <MetaItem label="Images" value={`${analysis.imageIds.length}`} />
            <MetaItem label="Origin" value={analysis.origin === 'imported' ? 'Imported' : 'Domestic'} />
          </Row>
        </Card>

        {scan ? <LegalSummaryCard scan={scan} /> : null}

        {/* Review prompt — the escalation path out of an uncertain verdict. */}
        {pending.length > 0 ? (
          <Card style={styles.reviewPrompt}>
            <Row gap={spacing.md} align="flex-start">
              <Ionicons name="person-circle-outline" size={22} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">Inspector review needed</Txt>
                <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                  {pluralize(pending.length, 'declaration')} could not be read with enough
                  confidence to stand on their own.
                </Txt>
              </View>
            </Row>
            <Button
              title="Start Review"
              icon="create-outline"
              fullWidth
              onPress={() => navigation.navigate('Review')}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : null}

        {compliance.warnings.length > 0 ? (
          <Card style={{ marginTop: spacing.md }}>
            <Txt variant="overline" color={colors.warning} style={{ marginBottom: spacing.sm }}>
              Warnings
            </Txt>
            {compliance.warnings.map((warning) => (
              <Row key={warning} align="flex-start" gap={spacing.sm} style={{ marginTop: spacing.xs }}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.warning} style={{ marginTop: 2 }} />
                <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                  {warning}
                </Txt>
              </Row>
            ))}
          </Card>
        ) : null}

        <View style={{ marginTop: spacing.xl, marginHorizontal: -spacing.base }}>
          <ChipBar<Tab> options={tabs} value={tab} onChange={setTab} />
        </View>

        <View style={{ marginTop: spacing.lg }}>
          {tab === 'fields' ? (
            <>
              <SectionHeader title="Extracted Information" />
              {analysis.fields.map((field) => (
                <ExtractedFieldCard
                  key={field.key}
                  field={field}
                  onViewEvidence={() => setEvidenceFor(field)}
                  onReview={() => navigation.navigate('Review')}
                />
              ))}
            </>
          ) : tab === 'issues' ? (
            <>
              <SectionHeader title="Findings" />
              {scan ? (
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
                compliance.violations.map((violation) => (
                  <ViolationCard key={violation.id} violation={violation} />
                ))
              )}
            </>
          ) : (
            <>
              <SectionHeader title="Rule Checks" />
              <Card>
                <Txt variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                  Assessed against {compliance.ruleSetLabel} ({compliance.ruleSetId})
                </Txt>
                {compliance.checks.map((check, index) => (
                  <View key={check.code}>
                    {index > 0 ? <View style={styles.hairline} /> : null}
                    <CheckRow
                      title={check.title}
                      ruleReference={check.ruleReference}
                      result={check.result}
                      message={check.message}
                    />
                  </View>
                ))}
              </Card>
            </>
          )}
        </View>

        {/*
          The mock provider does not look at the photograph.

          It returns one of a few fixed fixtures chosen by hashing the image
          bytes, so the declarations below belong to a sample label and not to
          the package that was photographed. Everything downstream — the
          extraction, the rule engine, the citations — is then working
          correctly on the wrong text, which is the most misleading state this
          app can be in and the one that most looks like a working scan.

          So it is called out above the result, not in a footnote under it.
        */}
        {scan?.ocr.provider === 'mock' ? (
          <Notice
            tone="warning"
            icon="flask-outline"
            text="Demonstration reading. No OCR ran on these photographs — the declarations below come from a sample label, not from this package. Set OCR_PROVIDER on the server to read the real thing."
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        <Notice
          icon="information-circle-outline"
          text={
            scan
              ? `Automated screening. The system reads the submitted photographs and checks them against the rules it implements (${scan.ruleSetVersion}). Results should be reviewed by an authorized inspector where evidence is incomplete or uncertain. This is not a determination that the package complies with every legal requirement.`
              : 'Automated screening. Results should be reviewed by an authorized inspector where evidence is incomplete or uncertain.'
          }
          style={{ marginTop: spacing.md }}
        />
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

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Txt variant="overline" color={colors.textFaint}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" style={{ marginTop: 2 }}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  metaRow: {
    marginTop: spacing.base,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reviewPrompt: {
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
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
