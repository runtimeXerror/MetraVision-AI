import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  CheckRow,
  ComplianceBadge,
  ExtractedFieldCard,
  ComplianceTally,
  LabelTextView,
  VerdictPanel,
  ViolationCard,
} from '../../components/domain';
import { ActionBar, Body, Notice, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import {
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
import { colors, spacing } from '../../constants/theme';
import { fieldsNeedingReview, useAnalysisStore } from '../../store/analysisStore';
import { useInspectionStore } from '../../store/inspectionStore';
import { formatDuration } from '../../utils/format';

import { INSPECTION_STEPS } from './InspectionDetailsScreen';

type Tab = 'fields' | 'issues' | 'checks' | 'text';

/**
 * Step 5 — the compliance result.
 *
 * Two verdicts, compliant or not. What the camera could not read is not a
 * third verdict; it is a declaration the officer is asked to confirm before
 * filing, and the engine re-runs against their answer.
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
  const details = useInspectionStore((state) => state.details);

  const [tab, setTab] = useState<Tab>('fields');
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

  // Only where there is a reading to show. A record from the older analyse
  // route has no scan, and a tab that opens on an empty state is a tab that
  // should not have been offered.
  if (scan?.ocr.rawText) {
    tabs.push({ value: 'text', label: 'Label text', count: scan.ocr.lineCount });
  }

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

        {/* The verdict, then how much of the package was in order. Two blocks,
            and nothing between them: everything that used to sit here said one
            of those two things again in a different shape. */}
        <ComplianceTally analysis={analysis} />

        {/* No "N declarations need your review" block here. The verdict is
            the verdict; a declaration the camera missed is corrected from the
            row itself or from the Review button below, and the nag that stood
            between the tally and the findings asked the officer to do that
            before they had read what was found. */}

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

        {/* What was examined, folded: an officer who chose the category does
            not need it read back to them. Everything that was genuinely about
            the *scan* — mean confidence, processing time, rule set version —
            has gone, each of it already said better elsewhere on the page. */}
        <Disclosure title="Product" icon="cube-outline" style={{ marginTop: spacing.md }}>
          <Detail label="Category" value={productCategoryLabels[analysis.category]} />
          {details.productName ? <Detail label="Product" value={details.productName} /> : null}
          {/* Imported packages carry declarations domestic ones do not — rule
              6(1)(aa) among them — so this is a legal fact about the commodity,
              not a statistic. */}
          <Detail label="Origin" value={analysis.origin === 'imported' ? 'Imported' : 'Domestic'} />
        </Disclosure>

        {/* The type-height notice that stood here is gone from the result.
            It is a standing limitation of the screening rather than a finding
            about this package — the same sentence on every scan — and printed
            in amber beside the verdict it read as though something were wrong
            with this packet. It belongs with the rule checks it concerns, where
            it appears against the two rules it is actually about. */}

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
              <ExtractedFieldCard key={field.key} field={field} />
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
          ) : tab === 'text' ? (
            scan ? (
              <LabelTextView scan={scan} />
            ) : null
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
  hairline: { height: 1, backgroundColor: colors.border },
});
