import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { BarList, ColumnChart, ShareLegend, StackedShareBar, type ShareSegment } from '../components/charts';
import { ComplianceBadge, StatTile, StatTileRowSkeleton } from '../components/domain';
import { GovHeader } from '../components/branding';
import { OfflineBar } from '../components/offline';
import { RuleBook } from '../components/rulebook';
import { Body, Screen, ScreenHeader } from '../components/layout';
import {
  Card,
  ChipBar,
  EmptyState,
  ErrorState,
  Pagination,
  Row,
  SectionHeader,
  Skeleton,
  Txt,
} from '../components/ui';
import {
  complianceStatusIcons,
  complianceStatusLabels,
  productCategoryLabels,
  severityLabels,
  violationCategoryLabels,
} from '../constants/labels';
import { colors, spacing } from '../constants/theme';
import { useAuthStore } from '../store/authStore';
import { PERIOD_OPTIONS, useDashboardStore, type PeriodDays } from '../store/dashboardStore';
import { useHistoryStore, type StatusFilter } from '../store/historyStore';
import { formatDate } from '../utils/format';
import { bucketCaption, bucketTrend } from '../utils/trend';

/**
 * Compliance status and enforcement activity.
 *
 * Every figure on this screen is aggregated by the backend over the selected
 * window, not derived from the page of records the History tab happens to be
 * holding. That is the difference between a dashboard and a summary of a
 * scroll position — and it is why the period selector reloads rather than
 * re-filtering what is already in memory.
 *
 * The whole of it downloads as a PDF on the department's letterhead, for filing
 * and for sending upward.
 */
export function ReportsScreen() {
  const navigation = useNavigation();
  const inspector = useAuthStore((state) => state.inspector);

  const overview = useDashboardStore((state) => state.overview);
  const days = useDashboardStore((state) => state.days);
  const loading = useDashboardStore((state) => state.loading);
  const refreshing = useDashboardStore((state) => state.refreshing);
  const error = useDashboardStore((state) => state.error);
  const fromCache = useDashboardStore((state) => state.fromCache);
  const cachedAt = useDashboardStore((state) => state.cachedAt);
  const load = useDashboardStore((state) => state.load);
  const setPeriod = useDashboardStore((state) => state.setPeriod);

  // The filed-reports list is the History tab's data, reused rather than
  // re-fetched so the two can never disagree about what has been filed.
  const setStatusFilter = useHistoryStore((state) => state.setStatusFilter);
  const clearFilters = useHistoryStore((state) => state.clearFilters);

  /**
   * A KPI is a count of records, so tapping it opens exactly those records.
   *
   * These four tiles were previously inert — an officer reading "12 violations"
   * had no way through to the twelve, and the number was a dead end. Filters
   * are cleared first, or the list arrives holding fewer records than the count
   * that was tapped to reach it.
   */
  const openRecords = useCallback(
    (status: StatusFilter) => {
      clearFilters();
      if (status !== 'all') setStatusFilter(status);
      navigation.navigate('Tabs', { screen: 'History' });
    },
    [clearFilters, setStatusFilter, navigation],
  );

  const items = useHistoryStore((state) => state.items);
  /**
   * A report exists once an inspection is filed and not before — the empty
   * state below says as much. The register page carries drafts and analysed
   * records too, and listing those here under "Filed reports" put a badge
   * on a document that did not exist yet.
   */
  const filed = useMemo(() => items.filter((item) => item.status === 'finalized'), [items]);
  /**
   * The filed-reports list is the inspection register, so it pages on the
   * register's own cursor rather than on a second one of its own. History is
   * driven by the same cursor, which means the two stay on the same page as
   * each other — correct here, since they are two views of one list, and the
   * alternative is two pagers that disagree about which page you are on.
   */
  const reportsPage = useHistoryStore((state) => state.page);
  const reportsTotalPages = useHistoryStore((state) => state.totalPages);
  const setReportsPage = useHistoryStore((state) => state.setPage);
  const historyLoading = useHistoryStore((state) => state.loading);
  const refreshHistory = useHistoryStore((state) => state.refreshAll);

  useFocusEffect(
    useCallback(() => {
      // Refreshed on focus rather than once on mount: an inspector reaches this
      // tab straight after filing, and a dashboard that still shows the figures
      // from before that inspection is worse than a spinner.
      void load({ refresh: overview !== null });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const segments = useMemo<ShareSegment[]>(() => {
    const at = (status: string) =>
      overview?.distribution.find((slice) => slice.status === status)?.count ?? 0;

    // The verdicts first, then the drafts that have none yet — carried so the
    // bar sums to the inspection count above it rather than to a denominator
    // the reader cannot see.
    return [
      {
        key: 'violation',
        label: complianceStatusLabels.violation,
        value: at('violation'),
        color: colors.danger,
        icon: complianceStatusIcons.violation,
      },
      {
        key: 'compliant',
        label: complianceStatusLabels.compliant,
        value: at('compliant'),
        color: colors.success,
        icon: complianceStatusIcons.compliant,
      },
      {
        key: 'not_assessed',
        label: 'Not yet assessed',
        value: at('not_assessed'),
        color: colors.neutral,
        icon: 'ellipse-outline',
      },
    ];
  }, [overview]);

  const buckets = useMemo(() => bucketTrend(overview?.trend ?? []), [overview]);
  const summary = overview?.summary;
  const busy = loading && !overview;

  const onRefresh = useCallback(() => {
    void Promise.all([load({ refresh: true }), refreshHistory()]);
  }, [load, refreshHistory]);

  return (
    <Screen edges={[]}>
      <GovHeader compact officerName={inspector?.name} officerId={inspector?.employeeId} />

      {/* No export control here.
          
          A report is issued per inspection — it carries one package, one set of
          findings and the provisions they were judged against, and that is the
          document an officer files or hands over. This screen is an aggregate
          view of activity, not a document, and offering to "download" it
          invited it to be treated as one. Each record's own report is on its
          detail screen, where the evidence behind it is a tap away. */}
      <ScreenHeader
        title="Dashboard"
        subtitle="Compliance status and enforcement activity"
      />

      <View style={{ paddingBottom: spacing.md }}>
        {/* The chip bar keys on strings; the window is a number, so it makes
            the round trip here rather than widening the shared component. */}
        <ChipBar
          options={PERIOD_OPTIONS.map((option) => ({
            value: String(option.value),
            label: option.label,
          }))}
          value={String(days)}
          onChange={(value) => setPeriod(Number(value) as PeriodDays)}
        />
      </View>

      <Body
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} />
        }
      >
        {/* Every figure below is an aggregate a supervisor may be shown. The
            date on a saved one is not a nicety — it is the difference between
            this month's compliance rate and last week's. */}
        <OfflineBar
          savedAt={fromCache ? cachedAt : null}
          style={{ marginBottom: spacing.md }}
        />

        {error && !overview ? (
          <Card>
            <ErrorState message={error.message} onRetry={() => void load()} />
          </Card>
        ) : (
          <>
            {/* ── Position ─────────────────────────────────────────────── */}
            <SectionHeader title="Position" />

            {busy || !summary ? (
              <>
                <StatTileRowSkeleton wide />
                <StatTileRowSkeleton style={{ marginTop: spacing.md }} />
              </>
            ) : (
              <>
                {/* The total on its own row, the two rates beneath it — the
                    same shape as Home. A "Pending Reviews" tile used to fill
                    the fourth cell and was removed. */}
                <Row gap={spacing.md} align="stretch">
                  <StatTile
                    wide
                    label="Inspections"
                    value={summary.totalInspections}
                    icon="clipboard-outline"
                    tone="info"
                    onPress={() => openRecords('all')}
                  />
                </Row>
                <Row gap={spacing.md} align="stretch" style={{ marginTop: spacing.md }}>
                  <StatTile
                    label="Compliance Rate"
                    value={`${summary.complianceRate}%`}
                    icon="shield-checkmark-outline"
                    tone="success"
                    onPress={() => openRecords('compliant')}
                  />
                  <StatTile
                    label="Violations"
                    value={summary.violations}
                    icon="alert-circle-outline"
                    tone="danger"
                    onPress={() => openRecords('violation')}
                  />
                </Row>

                {/* Nothing under the tiles. An "Average compliance score"
                    stood here once and was removed for re-collapsing the
                    engine's states into one number; the "Findings raised" and
                    "Records finalized" card that replaced it went the same
                    way — three figures an officer never acted on, between the
                    counts and the split of them. */}
              </>
            )}

            {/* ── Compliance status ────────────────────────────────────── */}
            <SectionHeader title="Compliance status" style={{ marginTop: spacing.xl }} />

            {busy ? (
              <Card>
                <Skeleton height={14} width="100%" />
                <Skeleton height={12} width="60%" style={{ marginTop: spacing.base }} />
                <Skeleton height={12} width="72%" style={{ marginTop: spacing.sm }} />
              </Card>
            ) : (
              <Card>
                <StackedShareBar segments={segments} />
                <ShareLegend segments={segments} style={{ marginTop: spacing.md }} />
              </Card>
            )}

            {/* ── Enforcement activity ─────────────────────────────────── */}
            <SectionHeader title="Enforcement activity" style={{ marginTop: spacing.xl }} />

            {busy ? (
              <Card>
                <Skeleton height={104} width="100%" />
              </Card>
            ) : (
              <Card>
                <ColumnChart
                  points={buckets}
                  caption={bucketCaption(overview?.trend ?? [], buckets)}
                />
              </Card>
            )}

            {/* ── Findings ─────────────────────────────────────────────── */}
            <SectionHeader title="Most frequent findings" style={{ marginTop: spacing.xl }} />

            {busy ? (
              <Card>
                <Skeleton height={12} width="70%" />
                <Skeleton height={8} width="100%" style={{ marginTop: spacing.md }} />
              </Card>
            ) : (
              <Card>
                <BarList
                  rows={(overview?.violationTypes ?? []).map((type) => ({
                    key: type.code,
                    label: type.title,
                    sublabel: `${violationCategoryLabels[type.category]} · ${
                      severityLabels[type.severity]
                    }`,
                    value: type.count,
                  }))}
                  emptyMessage="No findings were raised in this period."
                />
              </Card>
            )}

            {/* ── Categories ───────────────────────────────────────────── */}
            {overview && overview.violationsByCategory.length > 0 ? (
              <>
                <SectionHeader title="By product category" style={{ marginTop: spacing.xl }} />
                <Card>
                  <BarList
                    rows={overview.violationsByCategory.map((row) => ({
                      key: row.category,
                      label: productCategoryLabels[row.category],
                      sublabel: `${row.inspections} inspected`,
                      value: row.violations,
                    }))}
                    emptyMessage="No inspections were recorded in this period."
                  />
                  <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.md }}>
                    Bars count findings, not records — one label can contravene several rules.
                  </Txt>
                </Card>
              </>
            ) : null}

            {/* No officer-activity table.

                It restated figures the page already carries — the same
                inspections, compliant and violation counts as the KPI tiles
                and the distribution above, split by officer. On a handset an
                inspector is looking at their own work, so every row but one
                was somebody else's, and the one that was theirs was a second
                rendering of the numbers at the top of the same screen.

                The per-officer breakdown is a supervisor's view and it still
                exists on the web console, where there is room for it and a
                reader with a reason to compare officers. */}

            {/* ── The rulebook ─────────────────────────────────────────────
                Placed above the filed reports and below the figures: an
                officer arrives here for the numbers, and reaches for the law
                when one of them raises a question. */}
            <RuleBook />

            {/* ── Filed reports ────────────────────────────────────────── */}
            <SectionHeader title="Filed reports" style={{ marginTop: spacing.xl }} />

            {filed.length === 0 ? (
              <Card>
                <EmptyState
                  icon="document-text-outline"
                  title="No reports yet"
                  message="Finalize an inspection and its report will be listed here, ready to export."
                />
              </Card>
            ) : (
              <>
              <Card padded={false}>
                {filed.map((inspection, index) => (
                  <Pressable
                    key={inspection.id}
                    onPress={() =>
                      navigation.navigate('ReportDetail', { inspectionId: inspection.id })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Open the report for ${inspection.referenceId}`}
                    style={({ pressed }) => [pressed && { backgroundColor: colors.surfaceAlt }]}
                  >
                    {index > 0 ? <View style={styles.hairline} /> : null}
                    <Row justify="space-between" gap={spacing.md} style={styles.reportRow}>
                      <View style={{ flex: 1 }}>
                        <Txt variant="mono" color={colors.textMuted}>
                          {inspection.referenceId}
                        </Txt>
                        <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: 3 }}>
                          {inspection.businessName}
                        </Txt>
                        <Row gap={spacing.sm} style={{ marginTop: 6 }}>
                          {/* A filed record always carries its verdict; the
                              guard is for the type, not for a case. */}
                          {inspection.complianceStatus ? (
                            <ComplianceBadge status={inspection.complianceStatus} size="sm" />
                          ) : null}
                          <Txt variant="caption" color={colors.textFaint}>
                            {formatDate(inspection.createdAt)}
                          </Txt>
                        </Row>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                    </Row>
                  </Pressable>
                ))}
              </Card>

              {/* Only when there is somewhere to page to — `PAGE_SIZE` is 10,
                  so this appears from the eleventh filed report onward. */}
              {reportsTotalPages > 1 ? (
                <Pagination
                  page={reportsPage}
                  totalPages={reportsTotalPages}
                  onChange={setReportsPage}
                  disabled={historyLoading}
                  style={{ marginTop: spacing.md }}
                />
              ) : null}
              </>
            )}

          </>
        )}
      </Body>

    </Screen>
  );
}

const styles = StyleSheet.create({
  hairline: { height: 1, backgroundColor: colors.border },
  reportRow: { paddingHorizontal: spacing.base, paddingVertical: spacing.base },
});
