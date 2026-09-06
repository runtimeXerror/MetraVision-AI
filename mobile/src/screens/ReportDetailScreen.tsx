import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DepartmentMark } from '../components/branding';
import { ExportSheet } from '../components/ExportSheet';
import { ComplianceBadge, ComplianceTally, ImageThumb, VerdictPanel } from '../components/domain';
import { ImageViewer } from '../components/ImageViewer';
import { ActionBar, Body, Notice, Screen, ScreenHeader } from '../components/layout';
import { Button, Card, EmptyState, ErrorState, LoadingState, Row, SectionHeader, Txt } from '../components/ui';
import { LETTERHEAD } from '../constants/identity';
import { productCategoryLabels, severityLabels } from '../constants/labels';
import { colors, radius, spacing } from '../constants/theme';
import { useAsync } from '../hooks/useAsync';
import { useDocumentExport } from '../hooks/useDocumentExport';
import { OfflineBar } from '../components/offline';
import { loadReport } from '../services/offlineReads';
import { reportDocument } from '../services/reportService';
import { effectiveValue } from '../store/analysisStore';
import { useReportDraftStore } from '../store/reportDraftStore';
import type { RootScreenProps } from '../navigation/types';
import type { ComplianceCheck } from '../types';
import { formatDateTime } from '../utils/format';

/**
 * The inspection report — a document-shaped read of a filed inspection.
 *
 * Laid out as a report rather than as app chrome: an inspector shows this
 * screen to a dealer, and a supervisor reads it as the enforcement record.
 */
export function ReportDetailScreen({ route, navigation }: RootScreenProps<'ReportDetail'>) {
  const { inspectionId } = route.params;

  /** Which evidence photograph the full-screen viewer opens on; `null` is closed. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  /**
   * Read through the device.
   *
   * The report is the document an officer holds up to a dealer, and the
   * backend already builds it as a snapshot taken at issue time — so keeping a
   * copy on the phone reproduces the document that was issued rather than a
   * re-render of a record that has moved on. It is the single most valuable
   * thing in this app to have available with no signal.
   */
  const fetch = useCallback(() => loadReport(inspectionId), [inspectionId]);
  const { state, run } = useAsync(fetch);

  // Resolved lazily from the loaded report, so the Export button can sit in the
  // action bar from the first frame without being able to export a partial
  // record — the hook reports "not ready" rather than producing an empty PDF.
  const amendment = useReportDraftStore((store) => store.amendments[inspectionId]);

  const loaded = state.status === 'success' ? state.data.data : null;
  const exporter = useDocumentExport(
    useCallback(
      () => (loaded ? reportDocument(loaded, amendment) : null),
      [loaded, amendment],
    ),
  );

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <Screen>
        <ScreenHeader title="Report" onBack={() => navigation.goBack()} />
        <Body>
          <LoadingState label="Preparing report…" />
        </Body>
      </Screen>
    );
  }

  if (state.status === 'error') {
    return (
      <Screen>
        <ScreenHeader title="Report" onBack={() => navigation.goBack()} />
        <Body>
          <OfflineBar style={{ marginBottom: spacing.md }} />
          <Card>
            <ErrorState message={state.error.message} onRetry={() => void run()} />
          </Card>
        </Body>
      </Screen>
    );
  }

  const { data: report, savedAt } = state.data;
  const inspection = report.snapshot;
  const analysis = inspection.analysis;

  /**
   * Each declaration's own rule check, by field key.
   *
   * Mirrors `reportDocument`, which builds the same map for the PDF's Result
   * column. Built here rather than in the map callback so twenty declarations
   * do not each walk the whole check list.
   */
  const resultByField = new Map<string, ComplianceCheck>();
  for (const check of analysis?.compliance.checks ?? []) {
    for (const key of check.relatedFieldKeys) {
      if (!resultByField.has(key)) resultByField.set(key, check);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Inspection Report"
        subtitle={report.referenceId}
        onBack={() => navigation.goBack()}
      />

      <Body>
        {/* Above the letterhead, not below it. This document gets shown to the
            party it was issued against; if what is on screen is a copy saved
            three days ago, that has to be visible before the seal is, not in a
            footnote under it. */}
        <OfflineBar savedAt={savedAt} style={{ marginBottom: spacing.md }} />

        {/* Letterhead — the same mark and wording the exported PDF carries, so
            the screen an inspector shows a dealer and the document that is
            filed are recognisably one artefact. */}
        <Card style={styles.letterhead} padded={false}>
          <Row gap={spacing.md} align="flex-start" style={styles.letterheadBody}>
            <View style={{ flex: 1 }}>
              <DepartmentMark height={34} />
            </View>
            <View style={styles.govBlock}>
              <Txt variant="caption" color={colors.textMuted} style={styles.right}>
                {LETTERHEAD.governmentHi}
              </Txt>
              <Txt variant="label" style={styles.right}>
                {LETTERHEAD.governmentEn}
              </Txt>
              <Txt variant="caption" color={colors.textFaint} style={styles.right} numberOfLines={2}>
                {LETTERHEAD.ministryEn}
              </Txt>
              <Txt variant="caption" color={colors.textFaint} style={styles.right}>
                {LETTERHEAD.division}
              </Txt>
            </View>
          </Row>

          {/* A plain rule where the ribbon used to be: the identity block and
              the reference row are different registers and still need parting. */}
          <View style={styles.hairline} />

          <Row justify="space-between" wrap gap={spacing.md} style={styles.letterheadRefs}>
            <View>
              <Txt variant="overline" color={colors.textFaint}>
                Report No.
              </Txt>
              <Txt variant="mono" style={{ marginTop: 2 }}>
                {report.referenceId}
              </Txt>
            </View>
            <View>
              <Txt variant="overline" color={colors.textFaint}>
                Inspection No.
              </Txt>
              <Txt variant="mono" style={{ marginTop: 2 }}>
                {inspection.referenceId}
              </Txt>
            </View>
          </Row>
        </Card>

        {amendment ? (
          <Notice
            icon="create-outline"
            tone="warning"
            text={`This report carries amendments made by ${amendment.amendedBy}. The PDF prints each correction beside the value originally recorded; the filed inspection is unchanged.`}
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        {analysis ? (
          <View style={{ marginTop: spacing.md }}>
            <VerdictPanel
              status={analysis.compliance.status}
              ruleSetLabel={analysis.compliance.ruleSetLabel}
            />
            {/* The extent of the examination, directly under the verdict it
                supports. On a document that gets shown to the party it was
                issued against, "how much was read" belongs beside "what was
                found" and not several sections down. */}
            <ComplianceTally analysis={analysis} />
          </View>
        ) : (
          <Card style={{ marginTop: spacing.md }}>
            <EmptyState
              icon="hourglass-outline"
              title="No analysis on record"
              message="This inspection was filed without a completed analysis."
            />
          </Card>
        )}

        {/* Premises */}
        <SectionHeader title="Premises" style={{ marginTop: spacing.xl }} />
        <Card>
          <ReportRow label="Business / shop" value={inspection.details.businessName} />
          <View style={styles.hairline} />
          <ReportRow label="Location" value={inspection.details.location} />
          <View style={styles.hairline} />
          <ReportRow label="Inspected on" value={formatDateTime(inspection.createdAt)} />
          <View style={styles.hairline} />
          {/* The name alone. The officer's service number is printed once, in
              the signature block of the report, where an identifier on a legal
              document belongs — repeating it in brackets after every mention
              of the name said nothing the signature does not. */}
          <ReportRow label="Inspecting officer" value={inspection.inspectorName} />
        </Card>

        {/* Commodity */}
        <SectionHeader title="Commodity" style={{ marginTop: spacing.xl }} />
        <Card>
          <ReportRow
            label="Category"
            value={productCategoryLabels[inspection.details.productCategory ?? analysis?.category ?? 'other']}
          />
          <View style={styles.hairline} />
          <ReportRow label="Product" value={inspection.details.productName || 'Not specified'} />
          {analysis ? (
            <>
              <View style={styles.hairline} />
              <ReportRow label="Origin" value={analysis.origin === 'imported' ? 'Imported' : 'Domestic'} />
              <View style={styles.hairline} />
              <ReportRow label="Rules applied" value={analysis.compliance.ruleSetLabel} />
            </>
          ) : null}
        </Card>

        {/* Declarations */}
        {analysis ? (
          <>
            {/* "Declarations", not "Declarations Examined". Everything in this
                document was examined; the word was doing no work. */}
            <SectionHeader
              title={`Declarations (${analysis.fields.length})`}
              style={{ marginTop: spacing.xl }}
            />
            <Card>
              {analysis.fields.map((field, index) => {
                const value = effectiveValue(field);
                const check = resultByField.get(field.key);

                return (
                  <View key={field.key}>
                    {index > 0 ? <View style={styles.hairline} /> : null}
                    <View style={{ paddingVertical: spacing.md }}>
                      <Row justify="space-between" gap={spacing.md}>
                        {/* Numbered, like the findings below. A report read
                            aloud needs the declarations referable by position —
                            "item four" has to mean the same thing on the screen
                            and in the exported PDF. */}
                        <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                          {index + 1}. {field.label}
                        </Txt>
                        {/* The rule verdict for this declaration, against the
                            declaration. The exported PDF carries the same thing
                            as a Result column — the screen an officer shows a
                            dealer and the document that is filed have to say
                            the same words in the same places. */}
                        <ResultTag check={check} />
                      </Row>
                      <Txt
                        variant="bodyStrong"
                        color={value === null ? colors.danger : colors.text}
                        style={{ marginTop: 3 }}
                      >
                        {value ?? 'Not declared'}
                      </Txt>
                      {field.reviewAction === 'edited' && field.aiValue ? (
                        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                          Originally read as: {field.aiValue}
                        </Txt>
                      ) : field.reviewAction ? (
                        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                          Confirmed by the officer
                        </Txt>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Card>

            {/* Findings */}
            <SectionHeader
              title={`Findings (${analysis.compliance.violations.length})`}
              style={{ marginTop: spacing.xl }}
            />
            <Card>
              {analysis.compliance.violations.length === 0 ? (
                <Row gap={spacing.sm}>
                  <Ionicons name="shield-checkmark" size={17} color={colors.success} />
                  <Txt variant="body" color={colors.textMuted} style={{ flex: 1 }}>
                    No contravention was observed on the declarations examined.
                  </Txt>
                </Row>
              ) : (
                analysis.compliance.violations.map((violation, index) => (
                  <View key={violation.id}>
                    {index > 0 ? <View style={styles.hairline} /> : null}
                    <View style={{ paddingVertical: spacing.md }}>
                      <Row justify="space-between" gap={spacing.sm}>
                        <Txt variant="bodyStrong" style={{ flex: 1 }}>
                          {index + 1}. {violation.title}
                        </Txt>
                        <Txt variant="caption" color={colors.danger}>
                          {severityLabels[violation.severity]}
                        </Txt>
                      </Row>
                      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 4 }}>
                        {violation.description}
                      </Txt>
                      <Txt variant="caption" color={colors.navy} style={{ marginTop: 4 }}>
                        Contravenes {violation.ruleReference}
                      </Txt>
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        ) : null}

        {/* Evidence */}
        <SectionHeader
          title={`Evidence (${inspection.images.length})`}
          subtitle={inspection.images.length > 0 ? 'Tap a photograph to read the label' : undefined}
          style={{ marginTop: spacing.xl }}
        />
        {inspection.images.length === 0 ? (
          <Card>
            <Txt variant="caption" color={colors.textMuted}>
              No photographs attached to this record.
            </Txt>
          </Card>
        ) : (
          <Row gap={spacing.md} wrap>
            {inspection.images.map((image, position) => (
              <ImageThumb
                key={image.id}
                image={image}
                size={84}
                onPress={() => setViewerIndex(position)}
              />
            ))}
          </Row>
        )}

        {/* Remarks */}
        {inspection.details.inspectorNotes || inspection.finalNotes ? (
          <>
            <SectionHeader title="Remarks" style={{ marginTop: spacing.xl }} />
            <Card>
              {inspection.details.inspectorNotes ? (
                <Txt variant="body">{inspection.details.inspectorNotes}</Txt>
              ) : null}
              {inspection.finalNotes ? (
                <Txt
                  variant="body"
                  style={{ marginTop: inspection.details.inspectorNotes ? spacing.md : 0 }}
                >
                  {inspection.finalNotes}
                </Txt>
              ) : null}
            </Card>
          </>
        ) : null}

        {/* Attestation */}
        <Card style={styles.attestation}>
          <Row justify="space-between" align="flex-start">
            <View style={{ flex: 1 }}>
              <Txt variant="overline" color={colors.textFaint}>
                Filed by
              </Txt>
              <Txt variant="bodyStrong" style={{ marginTop: 3 }}>
                {inspection.inspectorName}
              </Txt>
              <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                {formatDateTime(report.generatedAt)}
              </Txt>
            </View>
            {inspection.complianceStatus ? (
              <ComplianceBadge status={inspection.complianceStatus} size="sm" />
            ) : null}
          </Row>
        </Card>

        {/* ── AND THIS ONE WAS ON THE REPORT ─────────────────────────────
            "Findings in this report were produced by a simulated analysis for
            demonstration."

            Printed under the findings of a document an officer shows a dealer.
            It was true in Phase 2 and false from Phase 4, and in between it sat
            on every report telling the party it was served on that the findings
            against them were fabricated for a demo. Nothing else in this
            application could do more damage to an enforcement action.

            The scan record carries the engine and its version, and the result
            screen says plainly when a reading really was a mock. Neither of
            those is a standing sentence on a filed document. */}
      </Body>

      <ActionBar>
        <Row gap={spacing.md}>
          <Button
            title={amendment ? 'Edit again' : 'Edit'}
            icon="create-outline"
            variant="secondary"
            size="lg"
            style={{ flex: 1 }}
            onPress={() => navigation.navigate('ReportEdit', { inspectionId })}
          />
          <Button
            title="Download PDF"
            icon="download-outline"
            size="lg"
            loading={exporter.downloading}
            style={{ flex: 1.4 }}
            onPress={exporter.download}
          />
        </Row>
      </ActionBar>

      <ExportSheet {...exporter.sheet} footnote={LETTERHEAD.departmentEn} />

      <ImageViewer
        images={inspection.images}
        startIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </Screen>
  );
}

/**
 * One declaration's rule verdict, as a word.
 *
 * "Pass" / "Fail" / "N/A" is test-runner vocabulary. A dealer reading this is
 * being told whether a legal requirement was met, and "Needs review" has to be
 * unmistakably distinct from "Not compliant" — only one of the two is an
 * adverse finding against them.
 *
 * A passing declaration says nothing at all. On a list where most rows comply,
 * printing "Compliant" twelve times turns the two that do not into something
 * the eye has to hunt for; silence is what makes them findable.
 */
function ResultTag({ check }: { check?: { result: string } }) {
  if (!check || check.result === 'pass' || check.result === 'not_applicable') return null;

  const failed = check.result === 'fail';

  return (
    <Txt variant="caption" color={failed ? colors.danger : colors.warning}>
      {failed ? 'Not compliant' : 'Needs review'}
    </Txt>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justify="space-between" gap={spacing.md} style={{ paddingVertical: spacing.md }}>
      <Txt variant="caption" color={colors.textMuted}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" style={{ flex: 1, textAlign: 'right' }} numberOfLines={3}>
        {value}
      </Txt>
    </Row>
  );
}

const styles = StyleSheet.create({
  letterhead: {
    overflow: 'hidden',
  },
  letterheadBody: { padding: spacing.base },
  govBlock: { maxWidth: 150 },
  right: { textAlign: 'right' },
  letterheadRefs: { paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  hairline: { height: 1, backgroundColor: colors.border },
  attestation: {
    marginTop: spacing.xl,
    backgroundColor: colors.surfaceAlt,
  },
});
