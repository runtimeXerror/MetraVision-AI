import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  CheckRow,
  ComplianceBadge,
  ComplianceTally,
  ExtractedFieldCard,
  ImageThumb,
  LabelTextView,
  VerdictPanel,
  ViolationCard,
} from '../components/domain';
import { ImageViewer } from '../components/ImageViewer';
import { ActionBar, Body, Screen, ScreenHeader } from '../components/layout';
import { Badge, Button, Card, ChipBar, EmptyState, LoadingState, ErrorState, Row, SectionHeader, Txt } from '../components/ui';
import { inspectionStatusLabels, inspectionStatusTones, productCategoryLabels } from '../constants/labels';
import { colors, spacing } from '../constants/theme';
import { useAsync } from '../hooks/useAsync';
import { OfflineBar } from '../components/offline';
import { loadInspection } from '../services/offlineReads';
import { fieldsNeedingReview } from '../store/analysisStore';
import { resumeInspection } from '../store/resume';
import type { RootScreenProps } from '../navigation/types';
import { formatConfidence, formatDateTime, formatDuration } from '../utils/format';

type Tab = 'summary' | 'fields' | 'issues' | 'checks' | 'text';

/** Read-only view of a completed inspection, opened from History or Home. */
export function InspectionDetailScreen({ route, navigation }: RootScreenProps<'InspectionDetail'>) {
  const { inspectionId } = route.params;
  const [tab, setTab] = useState<Tab>('summary');

  // Which photograph the full-screen viewer opens on. `null` is closed —
  // kept as one piece of state rather than a boolean plus an index, so the
  // two can never disagree about what is being shown.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Read through the device: a record the officer has opened before opens
  // again with no signal, which is the situation this screen is most often
  // needed in — standing in the premises, checking what was found last time.
  const fetch = useCallback(() => loadInspection(inspectionId), [inspectionId]);
  const { state, run } = useAsync(fetch);

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <Screen>
        <ScreenHeader title="Inspection" onBack={() => navigation.goBack()} />
        <Body>
          <LoadingState label="Loading inspection…" />
        </Body>
      </Screen>
    );
  }

  if (state.status === 'error') {
    return (
      <Screen>
        <ScreenHeader title="Inspection" onBack={() => navigation.goBack()} />
        <Body>
          {/* Says *why* there is nothing here, which the error alone does not:
              this record has never been opened on this device, so there was no
              saved copy to fall back to. */}
          <OfflineBar style={{ marginBottom: spacing.md }} />
          <Card>
            <ErrorState
              message={state.error.message}
              onRetry={() => void run()}
            />
          </Card>
        </Body>
      </Screen>
    );
  }

  const { data: inspection, savedAt } = state.data;
  const analysis = inspection.analysis;

  const finalized = inspection.status === 'finalized';
  // Declarations the engine could not settle on its own. The same list the
  // result screen names, so the count here and the count there agree.
  const pending = fieldsNeedingReview(analysis ?? null);

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'summary', label: 'Summary' },
    { value: 'fields', label: 'Extracted', count: analysis?.fields.length },
    { value: 'issues', label: 'Issues', count: analysis?.compliance.violations.length },
    { value: 'checks', label: 'Rule Checks', count: analysis?.compliance.checks.length },
  ];

  // Only where the record carries a reading to show. See `LabelTextView`.
  if (inspection.scan?.ocr.rawText) {
    tabs.push({ value: 'text', label: 'Label Text', count: inspection.scan.ocr.lineCount });
  }

  return (
    <Screen>
      <ScreenHeader
        title={inspection.referenceId}
        subtitle={inspection.details.businessName}
        onBack={() => navigation.goBack()}
        right={
          inspection.complianceStatus ? (
            <ComplianceBadge status={inspection.complianceStatus} size="sm" />
          ) : undefined
        }
      />

      <Body>
        <OfflineBar savedAt={savedAt} style={{ marginBottom: spacing.md }} />

        {analysis ? (
          <>
            <VerdictPanel
              status={analysis.compliance.status}
              ruleSetLabel={analysis.compliance.ruleSetLabel}
            />
            {/* How much was examined to reach that verdict. See the note at
                `ComplianceTally` — the panel above says what the package is,
                this says how much of it was read. */}
            <ComplianceTally analysis={analysis} />
          </>
        ) : (
          <Card>
            <EmptyState
              icon="hourglass-outline"
              title="Analysis not available"
              message="This inspection was recorded without a completed analysis."
            />
          </Card>
        )}

        <View style={{ marginTop: spacing.lg, marginHorizontal: -spacing.base }}>
          <ChipBar<Tab> options={tabs} value={tab} onChange={setTab} />
        </View>

        <View style={{ marginTop: spacing.lg }}>
          {tab === 'summary' ? (
            <>
              <Card>
                <Row justify="space-between" style={{ marginBottom: spacing.md }}>
                  <Txt variant="heading">Record</Txt>
                  <Badge
                    label={inspectionStatusLabels[inspection.status]}
                    tone={inspectionStatusTones[inspection.status]}
                    size="sm"
                  />
                </Row>

                <DetailRow label="Business" value={inspection.details.businessName} />
                <View style={styles.hairline} />
                <DetailRow label="Location" value={inspection.details.location} />
                <View style={styles.hairline} />
                <DetailRow
                  label="Category"
                  value={
                    productCategoryLabels[
                      inspection.details.productCategory ?? analysis?.category ?? 'other'
                    ]
                  }
                />
                <View style={styles.hairline} />
                <DetailRow label="Product" value={inspection.details.productName || 'Not specified'} />
                <View style={styles.hairline} />
                <DetailRow label="Inspector" value={inspection.inspectorName} />
                <View style={styles.hairline} />
                <DetailRow label="Recorded" value={formatDateTime(inspection.createdAt)} />
                {inspection.finalizedAt ? (
                  <>
                    <View style={styles.hairline} />
                    <DetailRow label="Finalized" value={formatDateTime(inspection.finalizedAt)} />
                  </>
                ) : null}
                {analysis ? (
                  <>
                    <View style={styles.hairline} />
                    <DetailRow label="Processing time" value={formatDuration(analysis.processingMs)} />
                  </>
                ) : null}

                {/* ── WHAT USED TO BE A SECOND CARD ──────────────────────
                    An "Analysis" card sat below this one carrying four rows:
                    engine, engine version, mean confidence and rule set. Three
                    of the four were already on the screen — the rule set is
                    named in the verdict panel above, and the confidence the
                    officer can act on is per-declaration, on the Extracted
                    tab, not as one average across a label. The card's real
                    content was the processing time, which is now a row of the
                    record it describes.

                    The engine and its version stay, because they are the
                    provenance of a finding somebody may be asked to defend —
                    but as a footnote, which is the weight they carry. */}
                {analysis ? (
                  <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.md }}>
                    Read by {analysis.engine} · {analysis.engineVersion} ·{' '}
                    {formatConfidence(analysis.meanConfidence)} mean confidence
                  </Txt>
                ) : null}
              </Card>

              <SectionHeader
                title={`Images (${inspection.images.length})`}
                subtitle={
                  inspection.images.length > 0 ? 'Tap a photograph to read the label' : undefined
                }
                style={{ marginTop: spacing.xl }}
              />
              {inspection.images.length === 0 ? (
                <Card>
                  <Txt variant="caption" color={colors.textMuted}>
                    No images attached to this record.
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

              {inspection.details.inspectorNotes || inspection.finalNotes ? (
                <>
                  <SectionHeader title="Notes" style={{ marginTop: spacing.xl }} />
                  <Card>
                    {inspection.details.inspectorNotes ? (
                      <View>
                        <Txt variant="overline" color={colors.textFaint}>
                          At intake
                        </Txt>
                        <Txt variant="body" style={{ marginTop: 4 }}>
                          {inspection.details.inspectorNotes}
                        </Txt>
                      </View>
                    ) : null}

                    {inspection.finalNotes ? (
                      <View style={{ marginTop: inspection.details.inspectorNotes ? spacing.md : 0 }}>
                        <Txt variant="overline" color={colors.textFaint}>
                          Closing remarks
                        </Txt>
                        <Txt variant="body" style={{ marginTop: 4 }}>
                          {inspection.finalNotes}
                        </Txt>
                      </View>
                    ) : null}
                  </Card>
                </>
              ) : null}
            </>
          ) : tab === 'fields' ? (
            analysis ? (
              analysis.fields.map((field) => <ExtractedFieldCard key={field.key} field={field} />)
            ) : (
              <Card>
                <EmptyState icon="list-outline" title="No extracted fields" />
              </Card>
            )
          ) : tab === 'issues' ? (
            analysis && analysis.compliance.violations.length > 0 ? (
              analysis.compliance.violations.map((violation, position) => (
                <ViolationCard key={violation.id} violation={violation} index={position + 1} />
              ))
            ) : (
              <Card>
                <EmptyState
                  icon="shield-checkmark-outline"
                  title="No violations recorded"
                  message="Every mandatory declaration for this category was found."
                />
              </Card>
            )
          ) : tab === 'text' ? (
            inspection.scan ? (
              <LabelTextView scan={inspection.scan} />
            ) : null
          ) : analysis ? (
            <Card>
              {analysis.compliance.checks.map((check, index) => (
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
          ) : (
            <Card>
              <EmptyState icon="list-outline" title="No rule checks" />
            </Card>
          )}
        </View>
      </Body>

      <ActionBar>
        <Row gap={spacing.md}>
          <Button
            title="Close"
            variant="secondary"
            size="lg"
            style={{ flex: 1 }}
            onPress={() => navigation.goBack()}
          />

          {/*
            ── THE WAY BACK IN ────────────────────────────────────────────
            Home counts what is waiting — "Pending Reviews" — and opens the
            records behind that number. Until now the trail stopped here: the
            record opened read-only, with Close and Open Report, and no way to
            do the review the tile had just sent the officer to do. The one
            figure on the home screen that is a to-do list led nowhere.

            An unfiled record therefore offers the work rather than the
            document. Where declarations are still waiting it goes to the
            review; where they are all settled it goes straight to filing,
            because that is the only step left. A filed record keeps Open
            Report, which is the only thing left to do with it.
          */}
          {finalized ? (
            <Button
              title="Open Report"
              icon="document-text-outline"
              size="lg"
              style={{ flex: 1.4 }}
              onPress={() => navigation.navigate('ReportDetail', { inspectionId })}
            />
          ) : (
            <Button
              title={pending.length > 0 ? `Review ${pending.length} left` : 'File this inspection'}
              icon={pending.length > 0 ? 'create-outline' : 'checkmark-done-outline'}
              size="lg"
              style={{ flex: 1.4 }}
              onPress={() => {
                // The review flow reads the capture stores, and a record opened
                // from History fills none of them. See `resumeInspection`.
                resumeInspection(inspection);
                navigation.navigate(pending.length > 0 ? 'Review' : 'Finalize');
              }}
            />
          )}
        </Row>
      </ActionBar>

      {/* Outside `Body`, so it covers the action bar too — a viewer with the
          screen's own buttons showing under it reads as a panel, not as the
          photograph being examined. */}
      <ImageViewer
        images={inspection.images}
        startIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
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
});
