import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  CheckRow,
  ComplianceBadge,
  ExtractedFieldCard,
  ImageThumb,
  VerdictPanel,
  ViolationCard,
} from '../components/domain';
import { ActionBar, Body, Screen, ScreenHeader } from '../components/layout';
import { Badge, Button, Card, ChipBar, EmptyState, LoadingState, ErrorState, Row, SectionHeader, Txt } from '../components/ui';
import { inspectionStatusLabels, inspectionStatusTones, productCategoryLabels } from '../constants/labels';
import { colors, spacing } from '../constants/theme';
import { useAsync } from '../hooks/useAsync';
import { getInspection } from '../services/inspectionService';
import type { RootScreenProps } from '../navigation/types';
import { formatConfidence, formatDateTime, formatDuration } from '../utils/format';

type Tab = 'summary' | 'fields' | 'issues' | 'checks';

/** Read-only view of a completed inspection, opened from History or Home. */
export function InspectionDetailScreen({ route, navigation }: RootScreenProps<'InspectionDetail'>) {
  const { inspectionId } = route.params;
  const [tab, setTab] = useState<Tab>('summary');

  const fetch = useCallback(() => getInspection(inspectionId), [inspectionId]);
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
          <Card>
            <ErrorState
              message={state.error.message}
              onRetry={state.error.retryable ? () => void run() : undefined}
            />
          </Card>
        </Body>
      </Screen>
    );
  }

  const inspection = state.data;
  const analysis = inspection.analysis;

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'summary', label: 'Summary' },
    { value: 'fields', label: 'Extracted', count: analysis?.fields.length },
    { value: 'issues', label: 'Issues', count: analysis?.compliance.violations.length },
    { value: 'checks', label: 'Rule Checks', count: analysis?.compliance.checks.length },
  ];

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
        {analysis ? (
          <VerdictPanel
            status={analysis.compliance.status}
            score={analysis.compliance.score}
            ruleSetLabel={analysis.compliance.ruleSetLabel}
          />
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
              </Card>

              {analysis ? (
                <Card style={{ marginTop: spacing.md }}>
                  <Txt variant="heading" style={{ marginBottom: spacing.md }}>
                    Analysis
                  </Txt>
                  <DetailRow label="Engine" value={`${analysis.engine} · ${analysis.engineVersion}`} />
                  <View style={styles.hairline} />
                  <DetailRow label="Mean confidence" value={formatConfidence(analysis.meanConfidence)} />
                  <View style={styles.hairline} />
                  <DetailRow label="Processing time" value={formatDuration(analysis.processingMs)} />
                  <View style={styles.hairline} />
                  <DetailRow label="Rule set" value={analysis.compliance.ruleSetLabel} />
                </Card>
              ) : null}

              <SectionHeader
                title={`Images (${inspection.images.length})`}
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
                  {inspection.images.map((image) => (
                    <ImageThumb key={image.id} image={image} size={72} />
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
              analysis.compliance.violations.map((violation) => (
                <ViolationCard key={violation.id} violation={violation} />
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
          ) : analysis ? (
            <Card>
              {analysis.compliance.checks.map((check, index) => (
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
          <Button
            title="Open Report"
            icon="document-text-outline"
            size="lg"
            style={{ flex: 1.4 }}
            onPress={() => navigation.navigate('ReportDetail', { inspectionId })}
          />
        </Row>
      </ActionBar>
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
