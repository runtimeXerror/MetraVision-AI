import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { confirm } from '../components/Dialog';

import { Input, Select } from '../components/forms';
import { ActionBar, Body, Notice, Screen, ScreenHeader } from '../components/layout';
import { Button, Card, ErrorState, LoadingState, Row, SectionHeader, Txt } from '../components/ui';
import { productCategoryLabels } from '../constants/labels';
import { PRODUCT_CATEGORIES } from '../types';
import { colors, radius, spacing } from '../constants/theme';
import { useAsync } from '../hooks/useAsync';
import type { RootScreenProps } from '../navigation/types';
import { getReport } from '../services/reportService';
import { useAuthStore } from '../store/authStore';
import {
  changedFields,
  draftFromReport,
  useReportDraftStore,
  type ReportAmendmentDraft,
} from '../store/reportDraftStore';
import type { ProductCategory } from '../types';

/**
 * The report editor.
 *
 * A form over the parts of a report an officer can legitimately correct before
 * issuing it: the premises, the commodity, what each declaration actually said,
 * and the remarks. Everything the rule engine decided — the verdict, the score,
 * the findings, the rule citations — is deliberately absent, because those are
 * conclusions drawn from the record rather than fields in it, and a report
 * whose verdict could be typed over would not be worth issuing.
 *
 * Corrections are held against this report and printed in the PDF *beside* the
 * value originally recorded, attributed to the officer who made them. The
 * stored inspection is never rewritten — the API refuses to mutate a finalized
 * record, and that refusal is the point rather than an obstacle.
 */
export function ReportEditScreen({ route, navigation }: RootScreenProps<'ReportEdit'>) {
  const { inspectionId } = route.params;

  const inspector = useAuthStore((state) => state.inspector);
  const amendments = useReportDraftStore((state) => state.amendments);
  const saveAmendment = useReportDraftStore((state) => state.save);
  const clearAmendment = useReportDraftStore((state) => state.clear);

  const fetch = useCallback(() => getReport(inspectionId), [inspectionId]);
  const { state, run } = useAsync(fetch);

  const existing = amendments[inspectionId];
  const report = state.status === 'success' ? state.data : null;

  const initial = useMemo(
    () => (report ? draftFromReport(report, existing) : null),
    [report, existing],
  );

  const [draft, setDraft] = useState<ReportAmendmentDraft | null>(null);
  const form = draft ?? initial;

  const set = useCallback(
    <K extends keyof ReportAmendmentDraft>(key: K, value: ReportAmendmentDraft[K]) => {
      setDraft((current) => ({ ...(current ?? initial ?? {}), [key]: value }));
    },
    [initial],
  );

  const setField = useCallback(
    (key: string, value: string) => {
      setDraft((current) => {
        const base = current ?? initial ?? {};
        return { ...base, fieldValues: { ...(base.fieldValues ?? {}), [key]: value } };
      });
    },
    [initial],
  );

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <Screen>
        <ScreenHeader title="Edit report" onBack={() => navigation.goBack()} />
        <Body>
          <LoadingState label="Loading the report…" />
        </Body>
      </Screen>
    );
  }

  if (state.status === 'error' || !report || !form) {
    return (
      <Screen>
        <ScreenHeader title="Edit report" onBack={() => navigation.goBack()} />
        <Body>
          <Card>
            <ErrorState
              message={state.status === 'error' ? state.error.message : 'The report could not be loaded.'}
              onRetry={() => void run()}
            />
          </Card>
        </Body>
      </Screen>
    );
  }

  const inspection = report.snapshot;
  const fields = inspection.analysis?.fields ?? [];
  const pending = changedFields(report, form);
  const changeCount =
    Object.keys(pending).filter((key) => key !== 'fieldValues').length +
    Object.keys(pending.fieldValues ?? {}).length;

  const onSave = () => {
    saveAmendment(inspectionId, pending, inspector ? `${inspector.name} (${inspector.employeeId})` : 'Inspecting officer');
    navigation.goBack();
  };

  const onDiscard = () => {
    void confirm({
      title: 'Discard amendments?',
      message:
        'The report will be issued exactly as it was recorded. Your corrections will be removed.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      clearAmendment(inspectionId);
      navigation.goBack();
    });
  };

  return (
    <Screen>
      <ScreenHeader
        title="Edit report"
        subtitle={report.referenceId}
        onBack={() => navigation.goBack()}
      />

      <Body>
        <Notice
          icon="shield-checkmark-outline"
          // Kept, because it is about what the officer is doing right now
          // rather than about the system, and shortened to the two facts that
          // change the decision: it is attributed, and nothing is overwritten.
          text="Your corrections are printed beside the original values and attributed to you. The filed record is not changed."
        />

        {/* Premises */}
        <SectionHeader title="Premises" style={{ marginTop: spacing.lg }} />
        <Card>
          <Input
            label="Business / shop"
            value={form.businessName ?? ''}
            onChangeText={(value) => set('businessName', value)}
            placeholder="Name of the shop or establishment"
          />
          <Input
            label="Address"
            value={form.location ?? ''}
            onChangeText={(value) => set('location', value)}
            placeholder="Street address"
            multiline
            numberOfLines={2}
          />
          <Row gap={spacing.md} align="flex-start">
            <View style={{ flex: 1 }}>
              <Input
                label="District"
                value={form.district ?? ''}
                onChangeText={(value) => set('district', value)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="State"
                value={form.state ?? ''}
                onChangeText={(value) => set('state', value)}
              />
            </View>
          </Row>
        </Card>

        {/* Commodity */}
        <SectionHeader title="Commodity" style={{ marginTop: spacing.xl }} />
        <Card>
          <Input
            label="Product"
            value={form.productName ?? ''}
            onChangeText={(value) => set('productName', value)}
            placeholder="As printed on the package"
          />
          <Select<ProductCategory>
            label="Category"
            value={form.productCategory}
            options={PRODUCT_CATEGORIES.map((category) => ({
              value: category,
              label: productCategoryLabels[category],
            }))}
            onChange={(value) => set('productCategory', value)}
            hint="The category decides which declarations are mandatory."
          />
        </Card>

        {/* Declarations */}
        {fields.length > 0 ? (
          <>
            <SectionHeader title="Declarations" style={{ marginTop: spacing.xl }} />
            <Card>
              <Txt variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.base }}>
                What the label actually declares. Leave a box empty where the declaration is absent
                from the package.
              </Txt>

              {fields.map((field) => {
                const recorded = field.humanValue ?? field.aiValue ?? '';
                const current = form.fieldValues?.[field.key] ?? '';
                const amended = current.trim() !== recorded.trim();

                return (
                  <View key={field.key}>
                    <Input
                      label={field.label}
                      required={field.required}
                      value={current}
                      onChangeText={(value) => setField(field.key, value)}
                      placeholder="Not declared"
                      containerStyle={{ marginBottom: amended ? spacing.xs : spacing.base }}
                    />
                    {amended ? (
                      <Row gap={spacing.xs} style={{ marginBottom: spacing.base }}>
                        <Ionicons name="git-compare-outline" size={13} color={colors.info} />
                        <Txt variant="caption" color={colors.info} style={{ flex: 1 }}>
                          Recorded as {recorded.length > 0 ? `“${recorded}”` : 'not declared'}
                        </Txt>
                      </Row>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        {/* Remarks */}
        <SectionHeader title="Remarks" style={{ marginTop: spacing.xl }} />
        <Card>
          <Input
            label="Remarks at inspection"
            value={form.inspectorNotes ?? ''}
            onChangeText={(value) => set('inspectorNotes', value)}
            placeholder="What was observed at the premises"
            multiline
            numberOfLines={3}
          />
          <Input
            label="Remarks on filing"
            value={form.finalNotes ?? ''}
            onChangeText={(value) => set('finalNotes', value)}
            placeholder="Action taken, samples retained, notices issued"
            multiline
            numberOfLines={3}
          />
          <Input
            label="Reason for amendment"
            value={form.amendmentNote ?? ''}
            onChangeText={(value) => set('amendmentNote', value)}
            placeholder="Why the report is being corrected before issue"
            hint="Printed under the attestation, so a reader can see why the document differs from the record."
            multiline
            numberOfLines={2}
          />
        </Card>

        {existing ? (
          <Button
            title="Discard all amendments"
            icon="trash-outline"
            variant="ghost"
            fullWidth
            style={{ marginTop: spacing.base }}
            onPress={onDiscard}
          />
        ) : null}
      </Body>

      <ActionBar>
        <Row gap={spacing.md} align="center">
          <View style={styles.count}>
            <Txt variant="caption" color={changeCount > 0 ? colors.info : colors.textFaint}>
              {changeCount === 0
                ? 'No changes'
                : `${changeCount} change${changeCount === 1 ? '' : 's'}`}
            </Txt>
          </View>
          <Button
            title="Save amendments"
            icon="checkmark-circle-outline"
            size="lg"
            style={{ flex: 1 }}
            onPress={onSave}
          />
        </Row>
      </ActionBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
